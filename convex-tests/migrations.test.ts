import { fakeMutationCtx, handlerOf } from './fakeDb';
import {
  backfillNameKeys,
  dedupeLiftingResults,
  duplicateMeetNames,
  normalizeAthleteGenders,
  normalizeReferenceCasing,
} from '../convex/migrations';

type Row = Record<string, unknown>;
type Paged = { cursor?: string | null; [key: string]: unknown };

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));
afterEach(() => jest.restoreAllMocks());

/** Runs a self-scheduling migration to the end, following its scheduled continuations. */
async function runPaged(name: string, handler: (ctx: unknown, args: Paged) => Promise<unknown>, store: ReturnType<typeof fakeMutationCtx>) {
  let args: Paged = {};
  for (let calls = 1; ; calls++) {
    const before = store.scheduled.length;
    await handler(store.ctx, args);
    const next = store.scheduled.slice(before).find((s) => s.name === name);
    if (!next) return calls;
    args = next.args as Paged;
  }
}

const result = (name: string, eventId: string, extra: Row = {}): Row => ({
  eventId,
  meet: `Meet ${eventId}`,
  date: '2026-09-01',
  name,
  nameKey: name.toLowerCase(),
  adaptive: false,
  federation: 'USAW',
  ...extra,
});

describe('backfillNameKeys (#166)', () => {
  it('rekeys rows folded before NFC, then starts the full rebuild', async () => {
    const store = fakeMutationCtx({
      lifting_results: [result('Jose\u0301 Pe', '1', { nameKey: 'jose\u0301 pe' }), result('Ann Lee', '1', { nameKey: 'ann lee' }), result('Bo Kim', '2', { nameKey: undefined })],
    });
    await handlerOf<Paged, void>(backfillNameKeys)(store.ctx, {});
    expect(store.rows('lifting_results').map((r) => r.nameKey)).toEqual(['jos\u00e9 pe', 'ann lee', 'bo kim']);
    expect(store.scheduled.map((s) => s.name)).toEqual(['views:rebuildAll']);
  });
});

describe('dedupeLiftingResults (#132)', () => {
  it('keeps the newest row of each identity across pages, events read once, and rewrites histories', async () => {
    const seed: Row[] = [];
    // 600 events of one athlete each; an event of copies sorting across the
    // first page's end (e498, then e498a); an event with one athlete in two
    // age categories (not copies).
    for (let i = 0; i < 600; i++) seed.push(result(`Athlete ${i}`, `e${String(i).padStart(3, '0')}`));
    seed.push(result('John Smith', 'e498a'), result('JOHN  SMITH', 'e498a', { total: 210 }), result('john smith', 'e498a', { total: 220 }));
    seed.push(result('Ann Lee', 'x2', { age: 'Open' }), result('Ann Lee', 'x2', { age: 'Masters 35' }));
    const store = fakeMutationCtx({ lifting_results: seed });
    const calls = await runPaged('migrations:dedupeLiftingResults', handlerOf<Paged, void>(dedupeLiftingResults), store);
    expect(calls).toBe(2);
    const remaining = store.rows('lifting_results');
    expect(remaining).toHaveLength(602 + 2 - 1);
    expect(remaining.filter((r) => r.eventId === 'e498a')).toEqual([expect.objectContaining({ name: 'john smith', total: 220 })]);
    expect(remaining.filter((r) => r.eventId === 'x2')).toHaveLength(2);
    expect(JSON.parse(store.rows('athlete_history').find((h) => h.nameKey === 'john smith')!.json as string)).toHaveLength(1);
    // A second run finds nothing.
    const before = store.rows('lifting_results').length;
    await runPaged('migrations:dedupeLiftingResults', handlerOf<Paged, void>(dedupeLiftingResults), store);
    expect(store.rows('lifting_results')).toHaveLength(before);
  });
});

describe('gender migrations (#165)', () => {
  it('rewrites athletes a page at a time, leaving hints for their meets', async () => {
    const athletes = Array.from({ length: 700 }, (_, i) => ({
      memberId: String(i),
      name: `A${i}`,
      age: 30,
      club: 'C',
      gender: i % 2 ? 'Male' : 'Women',
      weightClass: '64',
      entryTotal: 100,
      meet: i < 350 ? 'Meet A' : 'Meet B',
      adaptive: false,
    }));
    const store = fakeMutationCtx({ athletes });
    expect(await runPaged('migrations:normalizeAthleteGenders', handlerOf<Paged, void>(normalizeAthleteGenders), store)).toBe(2);
    expect(new Set(store.rows('athletes').map((a) => a.gender))).toEqual(new Set(['Men', 'Women']));
    expect(store.rows('view_hints').map((h) => `${h.kind}:${h.key}`).sort()).toEqual(['meet:Meet A', 'meet:Meet B', 'table:athletes']);
  });

  it('rewrites a reference table, keeping the newest row where spellings collide', async () => {
    const store = fakeMutationCtx({
      standards: [
        { ageCategory: 'Senior', gender: 'Male', weightClass: '89', standardA: 290, standardB: 270 },
        { ageCategory: 'Senior', gender: 'Men', weightClass: '89', standardA: 300, standardB: 280 },
        { ageCategory: 'Senior', gender: 'Female', weightClass: '64', standardA: 200, standardB: 190 },
      ],
    });
    expect(await handlerOf<{ table: string }, unknown>(normalizeReferenceCasing)(store.ctx, { table: 'standards' })).toEqual({ rows: 3, patched: 1, deleted: 1 });
    expect(store.rows('standards')).toEqual([
      { ageCategory: 'Senior', gender: 'Men', weightClass: '89', standardA: 300, standardB: 280 },
      { ageCategory: 'Senior', gender: 'Women', weightClass: '64', standardA: 200, standardB: 190 },
    ]);
  });
});

describe('duplicateMeetNames (#159)', () => {
  it('lists the names more than one meet holds, oldest first', async () => {
    const meet = (name: string, federation: string) => ({ name, federation, startDate: '2026-01-01', endDate: '2026-01-02', status: 'completed' });
    const store = fakeMutationCtx({ meets: [meet('Open', 'USAW'), meet('Solo', 'USAW'), meet('Open', 'USAMW')] });
    expect(await handlerOf<Record<string, never>, unknown>(duplicateMeetNames)(store.ctx, {})).toEqual([
      {
        name: 'Open',
        meets: [
          expect.objectContaining({ federation: 'USAW' }),
          expect.objectContaining({ federation: 'USAMW' }),
        ],
      },
    ]);
  });
});
