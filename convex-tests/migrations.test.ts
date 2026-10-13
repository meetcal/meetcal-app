import { fakeMutationCtx, handlerOf } from './fakeDb';
import {
  backfillNameKeys,
  dedupeLiftingResults,
  duplicateMeetNames,
  normalizeAthleteGenders,
  normalizeReferenceCasing,
  redateEventResults,
  resultDatePage,
  suspectResultDates,
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

describe('dedupeLiftingResults (#132, #369)', () => {
  it('keeps the newest row of each identity across pages, events read once, and rewrites histories', async () => {
    const seed: Row[] = [];
    // 600 events of one athlete each; an event of copies sorting across the
    // first page's end (e498, then e498a); an event with one athlete in two
    // age categories (not copies).
    for (let i = 0; i < 600; i++) seed.push(result(`Athlete ${i}`, `e${String(i).padStart(3, '0')}`));
    seed.push(result('John Smith', 'e498a', { total: 220 }), result('JOHN  SMITH', 'e498a', { total: 220 }), result('john smith', 'e498a', { total: 220 }));
    seed.push(result('Ann Lee', 'x2', { age: 'Open' }), result('Ann Lee', 'x2', { age: 'Masters 35' }));
    const store = fakeMutationCtx({ lifting_results: seed });
    const calls = await runPaged('migrations:dedupeLiftingResults', handlerOf<Paged, void>(dedupeLiftingResults), store);
    expect(calls).toBe(2);
    const remaining = store.rows('lifting_results');
    expect(remaining).toHaveLength(605 - 2);
    expect(remaining.filter((r) => r.eventId === 'e498a')).toEqual([expect.objectContaining({ name: 'john smith', total: 220 })]);
    expect(remaining.filter((r) => r.eventId === 'x2')).toHaveLength(2);
    expect(JSON.parse(store.rows('athlete_history').find((h) => h.nameKey === 'john smith')!.json as string)).toHaveLength(1);
    // A second run finds nothing.
    const before = store.rows('lifting_results').length;
    await runPaged('migrations:dedupeLiftingResults', handlerOf<Paged, void>(dedupeLiftingResults), store);
    expect(store.rows('lifting_results')).toHaveLength(before);
  });

  it("never deletes another edition's result under a reused event id, or a copy whose values differ", async () => {
    const lifts = { bodyWeight: 80.4, snatchBest: 120, cjBest: 155, total: 275 };
    const store = fakeMutationCtx({
      lifting_results: [
        // Event 4598: the 2020 Dallas result stored twice, and the 2021 one.
        result('Brandon Victorian', '4598', { meet: 'Dallas', date: '2020-10-31', legacyId: 108136, ...lifts }),
        result('Brandon Victorian', '4598', { meet: 'Dallas', date: '2020-10-31', ...lifts }),
        result('Brandon Victorian', '4598', { meet: 'Dallas', date: '2021-10-24', bodyWeight: 80.9, total: 310 }),
        // Two sets of values for one result: left for a person.
        result('Antonio Quinones', '4600', { total: 153 }),
        result('Antonio Quinones', '4600', { total: 160 }),
        // One edition stamped a day apart, the same lifts: copies.
        result('Matthew Tung', '7000', { date: '2026-05-16', ...lifts }),
        result('Matthew Tung', '7000', { date: '2026-05-17', ...lifts }),
      ],
    });
    await runPaged('migrations:dedupeLiftingResults', handlerOf<Paged, void>(dedupeLiftingResults), store);
    const remaining = store.rows('lifting_results');
    expect(remaining.filter((r) => r.eventId === '4598').map((r) => [r.date, r.total, r.legacyId])).toEqual([
      ['2020-10-31', 275, 108136],
      ['2021-10-24', 310, undefined],
    ]);
    expect(remaining.filter((r) => r.eventId === '4600').map((r) => r.total)).toEqual([153, 160]);
    expect(remaining.filter((r) => r.eventId === '7000').map((r) => r.date)).toEqual(['2026-05-17']);
    const logged = jest.mocked(console.log).mock.calls.map(([line]) => String(line));
    // Both on one line: a page's unresolved identities are logged together.
    const left = logged.filter((line) => line.startsWith('dedupeLiftingResults: left'));
    expect(left).toHaveLength(1);
    expect(left[0].split('\n').slice(1)).toEqual([expect.stringContaining('event 4598 "Dallas" "Brandon Victorian"'), expect.stringContaining('event 4600')]);
    expect(logged.at(-1)).toContain('2 duplicate rows deleted, 2 identities left');
  });

  it('deletes nothing on a dry run across pages, and counts what it would', async () => {
    const seed: Row[] = [];
    for (let i = 0; i < 600; i++) seed.push(result(`Athlete ${i}`, `e${String(i).padStart(3, '0')}`));
    seed.push(result('JOHN  SMITH', 'e001'), result('John Smith', 'e001'), result('John Smith', 'e550'), result('john smith', 'e550'));
    const store = fakeMutationCtx({ lifting_results: seed });
    const handler = handlerOf<Paged, void>(dedupeLiftingResults);
    let args: Paged = { dryRun: true };
    for (;;) {
      const before = store.scheduled.length;
      await handler(store.ctx, args);
      const next = store.scheduled.slice(before).find((s) => s.name === 'migrations:dedupeLiftingResults');
      if (!next) break;
      expect(next.args).toMatchObject({ dryRun: true });
      args = next.args as Paged;
    }
    expect(store.rows('lifting_results')).toHaveLength(604);
    expect(jest.mocked(console.log).mock.calls.at(-1)?.[0]).toContain('done (dry run), 2 duplicate rows to delete');
  });

  it('deletes a heavily duplicated event over several mutations, the same page again each time', async () => {
    const seed: Row[] = [];
    for (let i = 0; i < 450; i++) seed.push(result(`Athlete ${i}`, 'big'), result(`ATHLETE  ${i}`, 'big'));
    const store = fakeMutationCtx({ lifting_results: seed });
    const removed: number[] = [];
    const handler = handlerOf<Paged, void>(dedupeLiftingResults);
    const counting = async (ctx: unknown, args: Paged) => {
      const before = store.rows('lifting_results').length;
      await handler(ctx, args);
      removed.push(before - store.rows('lifting_results').length);
    };
    expect(await runPaged('migrations:dedupeLiftingResults', counting, store)).toBe(3);
    expect(removed).toEqual([200, 200, 50]);
    expect(store.rows('lifting_results')).toHaveLength(450);
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

describe('redateEventResults and resultDateProblems (#402)', () => {
  // Event 6959: the lifters' birth dates as result dates; another edition's
  // rows under the same id and another title are left alone.
  const seed = () => [
    result('Ann Lee', '6959', { meet: 'Summer Open', date: '1963-05-25', total: 150 }),
    result('Bo Kim', '6959', { meet: 'Summer Open', date: '2001-02-03', total: 160 }),
    result('Cy Day', '6959', { meet: 'Summer Open', date: '2025-07-12', total: 170 }),
    result('Di Ray', '6959', { meet: 'Summer Open 2019', date: '2019-07-13', total: 140 }),
  ];
  type Redate = { eventId: string; meet: string; date?: string; dryRun?: boolean };

  it('dry-runs by default, then re-dates only the named rows through the write path', async () => {
    const store = fakeMutationCtx({ lifting_results: seed() });
    const redate = handlerOf<Redate, { redated: number; remaining: number; wrong: number; dates: Record<string, number> }>(redateEventResults);
    const dry = await redate(store.ctx, { eventId: '6959', meet: 'Summer Open', date: '2025-07-12' });
    expect(dry).toMatchObject({ wrong: 2, redated: 0, remaining: 2, dates: { '1963-05-25': 1, '2001-02-03': 1 } });
    expect(store.rows('view_hints')).toHaveLength(0);

    const done = await redate(store.ctx, { eventId: '6959', meet: 'Summer Open', date: '2025-07-12', dryRun: false });
    expect(done).toMatchObject({ redated: 2, remaining: 0 });
    expect(store.rows('lifting_results').map((r) => [r.name, r.date])).toEqual([
      ['Ann Lee', '2025-07-12'],
      ['Bo Kim', '2025-07-12'],
      ['Cy Day', '2025-07-12'],
      ['Di Ray', '2019-07-13'],
    ]);
    expect(JSON.parse(store.rows('athlete_history').find((h) => h.nameKey === 'ann lee')!.json as string)[0].date).toBe('2025-07-12');
    expect(store.rows('view_hints').find((h) => h.kind === 'athlete' && h.key === 'ann lee')?.since).toBe('1963-05-25');
    expect(store.scheduled.map((s) => s.name)).toContain('views:refresh');
    expect(await redate(store.ctx, { eventId: '6959', meet: 'Summer Open', date: '2025-07-12', dryRun: false })).toMatchObject({ redated: 0, remaining: 0 });
  });

  it("never moves another edition's results under a reused event id and title unasked", async () => {
    // Event 4598: the Dallas meet in 2020 and 2021 under one id and title,
    // and two 2020 rows stored under birth dates.
    const dallas = (name: string, date: string) => result(name, '4598', { meet: 'Dallas', date, total: 150 });
    const seed2 = () => [
      ...['A', 'B', 'C', 'D'].map((n) => dallas(`2020 ${n}`, '2020-10-31')),
      dallas('Born Early', '1971-02-03'),
      dallas('Born Late', '1999-08-09'),
      ...['A', 'B', 'C', 'D', 'E'].map((n) => dallas(`2021 ${n}`, '2021-10-24')),
    ];
    type Answer = { crowded: string[]; wrong: number; redated: number; remaining: number };
    const redate = handlerOf<Redate & { keepDates?: string[]; moveDates?: string[] }, Answer>(redateEventResults);
    const store = fakeMutationCtx({ lifting_results: seed2() });
    expect(await redate(store.ctx, { eventId: '4598', meet: 'Dallas', date: '2020-10-31' })).toMatchObject({ crowded: ['2021-10-24'], wrong: 7 });
    await expect(redate(store.ctx, { eventId: '4598', meet: 'Dallas', date: '2020-10-31', dryRun: false })).rejects.toThrow('another edition or day');
    expect(store.rows('lifting_results').filter((r) => r.date === '2021-10-24')).toHaveLength(5);

    expect(await redate(store.ctx, { eventId: '4598', meet: 'Dallas', date: '2020-10-31', dryRun: false, keepDates: ['2021-10-24'] })).toMatchObject({ redated: 2, remaining: 0 });
    const byDate: Record<string, number> = {};
    for (const row of store.rows('lifting_results')) byDate[row.date as string] = (byDate[row.date as string] ?? 0) + 1;
    expect(byDate).toEqual({ '2020-10-31': 6, '2021-10-24': 5 });

    // `moveDates` moves a crowded date when that is what is wanted.
    const forced = fakeMutationCtx({ lifting_results: seed2() });
    expect(await redate(forced.ctx, { eventId: '4598', meet: 'Dallas', date: '2020-10-31', dryRun: false, moveDates: ['2021-10-24'] })).toMatchObject({ redated: 7 });
  });

  it('takes the stored meet date when none is given, and refuses a bad one', async () => {
    const store = fakeMutationCtx({ lifting_results: seed(), meets: [{ name: 'Summer Open', startDate: '2025-07-12', endDate: '2025-07-13' }] });
    const redate = handlerOf<Redate, { date: string; wrong: number }>(redateEventResults);
    expect(await redate(store.ctx, { eventId: '6959', meet: 'Summer Open' })).toMatchObject({ date: '2025-07-12', wrong: 2 });
    await expect(redate(store.ctx, { eventId: '6959', meet: 'Summer Open 2019' })).rejects.toThrow('pass the event');
    await expect(redate(store.ctx, { eventId: '6959', meet: 'Summer Open', date: '2025-7-12' })).rejects.toThrow('not a YYYY-MM-DD');
  });

  it('flags one date per lifter, not a meet\'s days or an event\'s editions', async () => {
    expect(suspectResultDates({ '2022-10-08': 1, '2022-10-09': 1, '2022-10-10': 1, '2022-10-11': 1, '2022-10-12': 1, '2022-10-13': 1 })).toBe(true);
    expect(suspectResultDates({ '2026-06-20': 300, '2026-06-21': 280, '2026-06-22': 310, '2026-06-23': 250, '2026-06-24': 200 })).toBe(false);
    expect(suspectResultDates({ '2020-03-01': 40, '2021-03-06': 45 })).toBe(false);
    const store = fakeMutationCtx({ lifting_results: seed() });
    const page = await handlerOf<{ cursor: null }, { groups: unknown[]; isDone: boolean }>(resultDatePage)(store.ctx, { cursor: null });
    expect(page).toMatchObject({
      isDone: true,
      groups: [
        { eventId: '6959', meet: 'Summer Open', dates: { '1963-05-25': 1, '2001-02-03': 1, '2025-07-12': 1 } },
        { eventId: '6959', meet: 'Summer Open 2019', dates: { '2019-07-13': 1 } },
      ],
    });
  });
});
