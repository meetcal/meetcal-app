import { computeAdaptiveRecords, RANKING_DIVISIONS } from '../convex/lib/referenceData';
import { natKey, REF_VIEWS } from '../convex/lib/viewKeys';
import { jsonChunks, writeView } from '../convex/lib/views';
import { clubAthletes, clubMeetStats, clubs, nationalRankings, registrationWsos, wsoAthletes, wsoList } from '../convex/reference';
import { storeClubs } from '../convex/views';
import { clubKey, clubLabels } from '../convex/lib/clubs';
import { ANONYMOUS_AUTH, fakeDb, handlerOf } from './fakeDb';

// Premium queries may log their caller (`convex/lib/access.ts`).
beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));

const STAMP = [{ table: 'lifting_results', version: 1 }];
/** A current division: a known ranking class with or without results (`requireKnownRankingClass`). */
const DIVISION = [...RANKING_DIVISIONS][0];

function query<Args>(fn: unknown, db: unknown, args: Args) {
  return handlerOf<Args, Record<string, unknown> | unknown[]>(fn)({ db, auth: ANONYMOUS_AUTH }, args);
}

const parse = (answer: unknown) => JSON.parse((answer as { json: string }).json) as unknown;

describe('national rankings and the club list while their views are stale or missing', () => {
  it('serve the last build while a change to it is pending', async () => {
    const fake = fakeDb({ view_hints: [{ kind: 'nat', key: JSON.stringify(['USAW', DIVISION]), seq: 0, updatedAt: 1 }] });
    await writeView({ db: fake.db } as never, natKey('USAW', DIVISION), jsonChunks([{ name: 'Ada', total: 200 }]), STAMP);
    await writeView({ db: fake.db } as never, REF_VIEWS.clubs, jsonChunks(['Alpha']), STAMP);
    await fake.db.insert('view_hints', { kind: 'table', key: 'athletes', seq: 0, updatedAt: 1 });
    expect(parse(await query(nationalRankings, fake.db, { federation: 'USAW', ageCategory: DIVISION }))).toEqual([{ name: 'Ada', total: 200 }]);
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
    // A known class nobody has a total in is empty; an unknown one is a 404.
    expect(parse(await query(nationalRankings, fake.db, { federation: 'USAW', ageCategory: DIVISION }))).toEqual([]);
    await expect(query(nationalRankings, fake.db, { federation: 'USAW', ageCategory: 'Nobody' })).rejects.toMatchObject({ data: { status: 404 } });
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

describe('WSO list (#412)', () => {
  it('leaves unmaintained WSOs out of a fresh view built before the filter', async () => {
    const fake = fakeDb({});
    await writeView({ db: fake.db } as never, REF_VIEWS.wso_list, jsonChunks(['Georgia', 'Michigan', 'Wisconsin']), [{ table: 'wso_records', version: 0 }]);
    expect(parse(await query(wsoList, fake.db, {}))).toEqual(['Georgia']);
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

  it('answer a client that does not page in the old shape, in full up to the array limit', async () => {
    const fake = fakeDb({ athletes: registrations(8192) });
    const rows = (await query(clubAthletes, fake.db, { club: 'Big Club' })) as { name: string; member_id: string }[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(8192);
    expect(rows[0]).toEqual({ name: 'Lifter 08191', meet: 'Meet 31', meet_date: null, club: 'Big Club', gender: 'Female', weight_class: '64', entry_total: 150, member_id: '8191' });
    expect(parse(await query(wsoAthletes, fake.db, { wso: 'California' }))).toHaveLength(8192);
  });

  it('past the array limit, keep an entry of every meet a club entered, then the most recent', async () => {
    // Two old meets whose only entries are the first written.
    const old = registrations(100).map((r, i) => ({ ...r, meet: i < 50 ? 'Old Meet A' : 'Old Meet B' }));
    const fake = fakeDb({ athletes: [...old, ...registrations(8200).map((r) => ({ ...r, memberId: `new ${r.memberId}` }))] });
    const rows = (await query(clubAthletes, fake.db, { club: 'Big Club' })) as { meet: string; member_id: string }[];
    expect(rows).toHaveLength(8192);
    expect(new Set(rows.map((r) => r.meet))).toEqual(new Set(['Old Meet A', 'Old Meet B', ...Array.from({ length: 40 }, (_, i) => `Meet ${i}`)]));
    // An entry of each meet (the old meets' only ones), then the most recently written.
    const ids = new Set(rows.map((r) => r.member_id));
    expect(['0', '50', 'new 50', 'new 8199'].every((id) => ids.has(id))).toBe(true);
    expect(['1', 'new 0', 'new 7'].some((id) => ids.has(id))).toBe(false);
  });

  it('cap a WSO list for a client that does not page at the most recent registrations', async () => {
    const fake = fakeDb({ athletes: registrations(30001) });
    const wso = parse(await query(wsoAthletes, fake.db, { wso: 'California' })) as { member_id: string }[];
    expect(wso).toHaveLength(30000);
    // The oldest registration is the one left out.
    expect(wso.some((r) => r.member_id === '0')).toBe(false);
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

describe('one club under several spellings (#363) and its meets by date (#341)', () => {
  const SPELLINGS = ['Ong Weightlifting', 'ONG weightlifting', 'ONG Weightlifting', 'Rose City', 'RoseCity', 'Rose City.', 'Boise Barbell'];
  const entry = (name: string, club: string, meet: string) => ({ name, club, meet, gender: 'Men', weightClass: '89', entryTotal: 200, memberId: name, age: 40, adaptive: false });

  async function seeded() {
    const fake = fakeDb({
      athletes: [
        entry('Al', 'Ong Weightlifting', '2026 USA Masters Nationals'),
        entry('Bo', 'ONG weightlifting', '2026 USA Masters Nationals'),
        entry('Cy', 'ONG Weightlifting', '2025 Howard Cohen'),
        entry('Al', 'ONG Weightlifting', '2025 Howard Cohen'),
        entry('Di', 'Rose City', 'Arnold'),
        entry('Ed', 'Boise Barbell', 'Arnold'),
      ],
      meets: [
        { name: '2026 USA Masters Nationals', startDate: '2026-03-27', endDate: '2026-03-29' },
        { name: '2025 Howard Cohen', startDate: '2025-12-11', endDate: '2025-12-14' },
      ],
    });
    await handlerOf<{ clubs: string[]; sources: unknown }>(storeClubs)({ db: fake.db }, { clubs: SPELLINGS, sources: [{ table: 'athletes', version: 1 }] });
    return fake;
  }

  it('fold case, spaces and punctuation into one key, and list one label per club', () => {
    expect(clubKey('ONG  weightlifting')).toBe(clubKey('Ong Weightlifting'));
    expect(clubKey('RoseCity')).toBe(clubKey('Rose City.'));
    expect(clubKey('FXT BB')).not.toBe(clubKey('FXT Barbell'));
    expect(clubLabels(SPELLINGS)).toHaveLength(3);
    expect(clubLabels(['ATLANTA PERFORMANCE', 'atlanta performance', 'Atlanta Performance'])).toEqual(['Atlanta Performance']);
  });

  it('list each club once, and answer its registrations under every spelling, with meet dates', async () => {
    const fake = await seeded();
    const listed = parse(await query(clubs, fake.db, {})) as string[];
    expect(listed).toHaveLength(3);
    expect(listed).toContain('Boise Barbell');

    const unpaged = (await query(clubAthletes, fake.db, { club: 'ong weightlifting' })) as { name: string; club: string; meet: string; meet_date: string | null }[];
    expect(unpaged.map((r) => [r.name, r.club, r.meet_date]).sort()).toEqual([
      ['Al', 'ONG Weightlifting', '2025-12-11'],
      ['Al', 'Ong Weightlifting', '2026-03-27'],
      ['Bo', 'ONG weightlifting', '2026-03-27'],
      ['Cy', 'ONG Weightlifting', '2025-12-11'],
    ]);
    const rose = (await query(clubAthletes, fake.db, { club: 'RoseCity' })) as { meet_date: string | null }[];
    expect(rose).toEqual([expect.objectContaining({ name: 'Di', meet_date: null })]);

    // Paged: one spelling after another until done.
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let pages = 0; pages < 10; pages += 1) {
      const page = (await query(clubAthletes, fake.db, { club: 'Ong Weightlifting', cursor })) as { json: string; cursor: string; isDone: boolean };
      seen.push(...(JSON.parse(page.json) as { name: string; club: string }[]).map((r) => `${r.name}|${r.club}`));
      if (page.isDone) break;
      cursor = page.cursor;
    }
    expect(seen.sort()).toEqual(['Al|ONG Weightlifting', 'Al|Ong Weightlifting', 'Bo|ONG weightlifting', 'Cy|ONG Weightlifting']);
  });

  it('page every spelling once even when the spellings list changes between pages', async () => {
    const fake = await seeded();
    type Page = { json: string; cursor: string; isDone: boolean };
    const page1 = (await query(clubAthletes, fake.db, { club: 'Ong Weightlifting', cursor: null })) as Page;
    const seen = (JSON.parse(page1.json) as { name: string; club: string }[]).map((r) => `${r.name}|${r.club}`);
    // A new spelling registers and the list is rebuilt, sorting before the rest.
    await fake.db.insert('athletes', entry('Ed', 'ONG-Weightlifting', 'Arnold'));
    await handlerOf<{ clubs: string[]; sources: unknown }>(storeClubs)({ db: fake.db }, { clubs: [...SPELLINGS, 'ONG-Weightlifting'], sources: [{ table: 'athletes', version: 2 }] });
    let cursor: string | null = page1.cursor;
    for (let pages = 0; pages < 10 && !page1.isDone; pages += 1) {
      const page = (await query(clubAthletes, fake.db, { club: 'Ong Weightlifting', cursor })) as Page;
      seen.push(...(JSON.parse(page.json) as { name: string; club: string }[]).map((r) => `${r.name}|${r.club}`));
      if (page.isDone) break;
      cursor = page.cursor;
    }
    expect(seen.sort()).toEqual(['Al|ONG Weightlifting', 'Al|Ong Weightlifting', 'Bo|ONG weightlifting', 'Cy|ONG Weightlifting', 'Ed|ONG-Weightlifting']);
  });

  it("keep a small spelling's meet in an unpaged answer a large spelling fills, within a query's index ranges", async () => {
    const big = Array.from({ length: 8193 }, (_, i) => entry(`Lifter ${i}`, 'Ong Weightlifting', 'Big Meet'));
    const fake = fakeDb({ athletes: [entry('Solo', 'ONG weightlifting', 'Small Meet'), ...big], meets: [{ name: 'Small Meet', startDate: '2026-01-10', endDate: '2026-01-10' }] });
    await handlerOf<{ clubs: string[]; sources: unknown }>(storeClubs)({ db: fake.db }, { clubs: ['Ong Weightlifting', 'ONG weightlifting'], sources: [{ table: 'athletes', version: 1 }] });
    let queries = 0;
    const db = { ...fake.db, query: (table: string) => (queries++, fake.db.query(table)) };
    const rows = (await query(clubAthletes, db, { club: 'Ong Weightlifting' })) as { meet: string; meet_date: string | null }[];
    expect(rows).toHaveLength(8192);
    expect(rows.find((r) => r.meet === 'Small Meet')).toMatchObject({ meet_date: '2026-01-10' });
    expect(queries).toBeLessThan(4096);
  });

  it("count a club's athletes at a meet under a spelling registered since the spellings were built", async () => {
    const fake = await seeded();
    await fake.db.insert('athletes', entry('Ed', 'ONG-Weightlifting', '2026 USA Masters Nationals'));
    const stats = (await query(clubMeetStats, fake.db, { club: 'Ong Weightlifting', meet: '2026 USA Masters Nationals' })) as { total_athletes: number };
    expect(stats.total_athletes).toBe(3);
  });

  it("count a club's athletes at a meet under every spelling", async () => {
    const fake = await seeded();
    const stats = (await query(clubMeetStats, fake.db, { club: 'ONG Weightlifting', meet: '2026 USA Masters Nationals' })) as { total_athletes: number };
    expect(stats.total_athletes).toBe(2);
  });
});

describe('registration WSO names', () => {
  it('lists each WSO registrations name once, without missing or blank ones', async () => {
    const fake = fakeDb({
      athletes: [
        { wso: 'Mountain North' },
        { wso: 'California North Central' },
        {},
        { wso: 'Mountain North' },
        { wso: '' },
        { wso: ' ' },
        { wso: 'Florida' },
      ],
    });
    expect(await query(registrationWsos, fake.db, {})).toEqual(['California North Central', 'Florida', 'Mountain North']);
    // One read per WSO (and the blank one), not one per registration.
    expect(fake.reads.count).toBeLessThanOrEqual(5);
  });
});
