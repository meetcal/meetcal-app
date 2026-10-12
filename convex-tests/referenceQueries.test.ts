import { computeAdaptiveRecords } from '../convex/lib/referenceData';
import { natKey, REF_VIEWS } from '../convex/lib/viewKeys';
import { jsonChunks, writeView } from '../convex/lib/views';
import { clubAthletes, clubs, nationalRankings, wsoAthletes } from '../convex/reference';
import { fakeDb, handlerOf } from './fakeDb';

const STAMP = [{ table: 'lifting_results', version: 1 }];

function query<Args>(fn: unknown, db: unknown, args: Args) {
  return handlerOf<Args, Record<string, unknown> | unknown[]>(fn)({ db }, args);
}

const parse = (answer: unknown) => JSON.parse((answer as { json: string }).json) as unknown;

describe('national rankings and the club list while their views are stale or missing', () => {
  it('serve the last build while a change to it is pending', async () => {
    const fake = fakeDb({ view_hints: [{ kind: 'nat', key: JSON.stringify(['USAW', 'Open']), seq: 0, updatedAt: 1 }] });
    await writeView({ db: fake.db } as never, natKey('USAW', 'Open'), jsonChunks([{ name: 'Ada', total: 200 }]), STAMP);
    await writeView({ db: fake.db } as never, REF_VIEWS.clubs, jsonChunks(['Alpha']), STAMP);
    await fake.db.insert('view_hints', { kind: 'table', key: 'athletes', seq: 0, updatedAt: 1 });
    expect(parse(await query(nationalRankings, fake.db, { federation: 'USAW', ageCategory: 'Open' }))).toEqual([{ name: 'Ada', total: 200 }]);
    expect(parse(await query(clubs, fake.db, {}))).toEqual(['Alpha']);
  });

  it('answer a class with no view live when one page holds it', async () => {
    const fake = fakeDb({
      lifting_results: [
        { federation: 'USAW', age: 'New', name: 'Ada', total: 150 },
        { federation: 'USAW', age: 'New', name: 'Ada', total: 180 },
        { federation: 'USAW', age: 'New', name: 'Bo', total: 0 },
      ],
      athletes: [{ club: 'Beta' }, { club: '' }, { club: 'Alpha' }, { club: 'Beta' }],
    });
    expect(parse(await query(nationalRankings, fake.db, { federation: 'USAW', ageCategory: 'New' }))).toEqual([{ name: 'Ada', total: 180 }]);
    expect(parse(await query(nationalRankings, fake.db, { federation: 'USAW', ageCategory: 'Nobody' }))).toEqual([]);
    expect(parse(await query(clubs, fake.db, {}))).toEqual(['Alpha', 'Beta']);
  });

  it('refuse, rather than read without bound, a large class or club list that has no view yet', async () => {
    const fake = fakeDb({
      lifting_results: Array.from({ length: 1001 }, (_, i) => ({ federation: 'USAW', age: 'Big', name: `Lifter ${i}`, total: 100 })),
      athletes: Array.from({ length: 101 }, (_, i) => ({ club: `Club ${String(i).padStart(3, '0')}` })),
    });
    await expect(query(nationalRankings, fake.db, { federation: 'USAW', ageCategory: 'Big' })).rejects.toMatchObject({ data: { status: 503 } });
    await expect(query(clubs, fake.db, {})).rejects.toMatchObject({ data: { status: 503 } });
  });
});

describe('club and WSO athlete lists', () => {
  const registrations = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      name: `Lifter ${String(i).padStart(5, '0')}`,
      meet: `Meet ${i % 40}`,
      club: 'Big Club',
      wso: 'California',
      gender: 'Women',
      weightClass: '64',
      entryTotal: 150,
      memberId: String(i),
    }));

  it('page through every registration with a cursor', async () => {
    const fake = fakeDb({ athletes: registrations(4500) });
    for (const [fn, args] of [
      [clubAthletes, { club: 'Big Club' }],
      [wsoAthletes, { wso: 'California' }],
    ] as const) {
      const seen: { name: string; club: string; wso?: string }[] = [];
      let cursor: string | null = null;
      for (let pages = 1; ; pages += 1) {
        const page = (await query(fn, fake.db, { ...args, cursor })) as { json: string; cursor: string; isDone: boolean };
        const rows = JSON.parse(page.json) as { name: string; club: string; wso?: string }[];
        expect(rows.length).toBeLessThanOrEqual(2000);
        // Each page is in name order, descending.
        expect(rows.map((r) => r.name)).toEqual([...rows.map((r) => r.name)].sort().reverse());
        seen.push(...rows);
        if (page.isDone) {
          expect(pages).toBe(3);
          break;
        }
        cursor = page.cursor;
      }
      expect(new Set(seen.map((r) => r.name)).size).toBe(4500);
      if (fn === wsoAthletes) expect(seen.every((r) => r.wso === 'California')).toBe(true);
    }
  });

  it('answer a client that does not page in the old shape, capped at the most recent registrations', async () => {
    const fake = fakeDb({ athletes: registrations(8100) });
    const rows = (await query(clubAthletes, fake.db, { club: 'Big Club' })) as { name: string; member_id: string }[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(8000);
    // The oldest 100 registrations are the ones left out.
    expect(rows.some((r) => r.member_id === '99')).toBe(false);
    expect(rows[0]).toEqual({ name: 'Lifter 08099', meet: 'Meet 19', club: 'Big Club', gender: 'Women', weight_class: '64', entry_total: 150, member_id: '8099' });
    // Text has no element limit: the WSO list keeps more.
    const wso = parse(await query(wsoAthletes, fake.db, { wso: 'California' })) as unknown[];
    expect(wso).toHaveLength(8100);
  });
});

describe('adaptive records', () => {
  it('read only the season’s adaptive results', async () => {
    const fake = fakeDb({
      lifting_results: [
        { adaptive: true, date: '2025-12-31', age: "Men's 88kg", total: 300, snatchBest: 130, cjBest: 170 },
        { adaptive: true, date: '2026-02-01', age: "Men's 88kg", total: 200, snatchBest: 90, cjBest: 110 },
        { adaptive: true, date: '2026-03-01', age: "Men's 88kg", total: 250, snatchBest: 110, cjBest: 140, federation: 'BWL' },
        { adaptive: false, date: '2026-03-01', age: "Men's 88kg", total: 280, snatchBest: 120, cjBest: 160 },
      ],
    });
    expect(await computeAdaptiveRecords({ db: fake.db } as never, 'men', 'BWL', '2026')).toEqual([{ weight_class: '88', snatch: 90, cj: 110, total: 200 }]);
    // One index range: the earlier season's row is never read.
    expect(fake.reads.count).toBe(2);
  });
});
