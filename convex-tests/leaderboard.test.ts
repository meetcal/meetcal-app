import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getFunctionName } from 'convex/server';
import { ConvexError } from 'convex/values';
import { passes } from '../convex/accessPass';
import { setPremiumModeForTests } from '../convex/lib/access';
import {
  checkLeaderboardArgs,
  consistentTotal,
  type LeaderboardArgs,
  type LeaderboardFilters,
  type LeaderboardMetric,
  monthSlices,
  normalizeCategory,
  parseDivision,
  plausible,
  pruneBests,
  qpoints,
  rank,
  type RankedFields,
  rowQpoints,
  rowSinclair,
  sinclair,
} from '../convex/lib/leaderboard';
import { LEADERBOARD_MAX_PAGES, LEADERBOARD_PAGE_SIZE, leaderboard, leaderboardPage, type LeaderboardAnswer } from '../convex/results';
import { fakeDb, handlerOf } from './fakeDb';

/**
 * `results:leaderboard` (`convex/lib/leaderboard.ts`): the CLI's
 * leaderboard ranking (`cli/src/commands/leaderboard.rs`) and guards
 * (`cli/src/utils/stats.rs`), moved to the server. The numbers are the CLI's
 * own unit tests', so the port changed no answer.
 */

/** A result row with its bests and total computed from its attempts, typos and all, like the CLI's `row`. */
function row(name: string, date: string, meet: string, age: string, bw: number, snatch: number[], cj: number[]): RankedFields {
  const best = (lifts: number[]) => lifts.reduce((max, lift) => Math.max(max, lift), 0);
  const [sb, cb] = [best(snatch), best(cj)];
  return {
    federation: 'USAW',
    meet,
    date,
    name,
    age,
    body_weight: bw,
    snatch1: snatch[0],
    snatch2: snatch[1],
    snatch3: snatch[2],
    snatch_best: sb,
    cj1: cj[0],
    cj2: cj[1],
    cj3: cj[2],
    cj_best: cb,
    total: sb > 0 && cb > 0 ? sb + cb : 0,
    adaptive: false,
  };
}

const rows = (): RankedFields[] => [
  row('Ada', '2026-01-01', 'M1', "Open Women's 64kg", 63, [85, 0, 0], [105, 0, 0]),
  row('Ada', '2026-05-01', 'M2', "Open Women's 64kg", 63, [88, 0, 0], [108, 0, 0]),
  row('Bo', '2026-02-01', 'M1', "Open Men's 89kg", 88, [140, 0, 0], [175, 0, 0]),
  row('Cy', '2026-03-01', 'M1', "Women's Masters (45-49) 71kg", 70, [60, 0, 0], [75, 0, 0]),
];

const names = (metric: LeaderboardMetric, filters: LeaderboardFilters = {}, input = rows(), limit = 10) =>
  rank(input, metric, filters, limit).map(({ row }) => row.name);

describe('the ranking (the CLI’s `rank`)', () => {
  it('ranks each athlete once, by their best', () => {
    const ranked = rank(rows(), 'total', {}, 10);
    expect(ranked.map(({ row }) => row.name)).toEqual(['Bo', 'Ada', 'Cy']);
    expect(ranked[1].row.date).toBe('2026-05-01');
    expect(ranked[1].value).toBe(196);
    expect(names('total', {}, rows(), 2)).toEqual(['Bo', 'Ada']);
  });

  it('counts a name in any case or spacing as one athlete', () => {
    const input = [...rows(), row('  ada ', '2026-06-01', 'M3', "Open Women's 64kg", 63, [90, 0, 0], [110, 0, 0])];
    expect(names('total', {}, input)).toEqual(['Bo', '  ada ', 'Cy']);
  });

  it('breaks ties by the earlier result, then the name, and keeps an athlete’s first row on a full tie', () => {
    const tie = [
      row('Zed', '2026-02-01', 'Later', "Open Men's 89kg", 88, [100, 0, 0], [120, 0, 0]),
      row('Max', '2026-03-01', 'M', "Open Men's 89kg", 88, [100, 0, 0], [120, 0, 0]),
      row('Ann', '2026-02-01', 'M', "Open Men's 89kg", 88, [100, 0, 0], [120, 0, 0]),
      row('Zed', '2026-01-01', 'Earlier', "Open Men's 89kg", 88, [100, 0, 0], [120, 0, 0]),
      row('Ann', '2026-02-01', 'Second', "Open Men's 89kg", 88, [100, 0, 0], [120, 0, 0]),
    ];
    const ranked = rank(tie, 'total', {}, 10);
    expect(ranked.map(({ row }) => [row.name, row.meet])).toEqual([
      ['Zed', 'Earlier'],
      ['Ann', 'M'],
      ['Max', 'M'],
    ]);
  });

  it('filters by gender, category and division', () => {
    expect(names('snatch', { gender: 'Women' })).toHaveLength(2);
    expect(names('total', { category: 'Masters 45' })).toEqual(['Cy']);
    expect(names('total', { category: ' masters 45 ' })).toEqual(['Cy']);
    expect(names('total', { division: '89KG' })).toEqual(['Bo']);
  });

  it('leaves adaptive results out unless asked for', () => {
    const adaptive = { ...row('Ed', '2026-04-01', 'M', "Open Men's 89kg", 88, [150, 0, 0], [190, 0, 0]), adaptive: true };
    expect(names('total', {}, [...rows(), adaptive])).not.toContain('Ed');
    expect(names('total', { adaptive: true }, [...rows(), adaptive])[0]).toBe('Ed');
  });

  it('ranks British results only when the federation asks for them', () => {
    const british = {
      ...row('Ramiro', '2025-06-01', 'British Senior Championships 2025', "Men's Senior 110Kg", 109, [170, 0, 0], [202, 0, 0]),
      federation: 'BWL',
    };
    const input = [...rows(), british];
    expect(names('total', {}, input)).not.toContain('Ramiro');
    expect(names('total', { federation: 'bwl' }, input)).toEqual(['Ramiro']);
    expect(names('total', { federation: ' usaw ' }, input)).toEqual(['Bo', 'Ada', 'Cy']);
  });

  it('lets Sinclair reorder a leaderboard, and leaves youth out of Q-points', () => {
    expect(names('sinclair', {}, rows(), 1)).toEqual(['Bo']);
    const youth = row('Yu', '2026-04-01', 'M1', "Men's 16-17 Age Group 81kg", 80, [150, 0, 0], [190, 0, 0]);
    const ranked = names('qpoints', {}, [...rows(), youth]);
    expect(ranked).not.toContain('Yu');
    expect(ranked).toHaveLength(3);
  });

  it('leaves source errors out', () => {
    const typo = row('Typo', '2026-04-04', 'M', "Open Men's 89kg", 88, [-63, 633, 65], [85, 90, -95]);
    const placeholder = row('Placeholder', '2026-04-04', 'M', "Open Men's 89kg", 88, [100, 200, 300], [100, 0, 0]);
    const shifted = { ...row('Shifted', '2026-04-04', 'M', "Open Men's 110kg", 105, [127, 0, 0], [135, 0, 0]), total: 148 };
    expect(names('total', {}, [...rows(), typo, placeholder, shifted])).toEqual(['Bo', 'Ada', 'Cy']);
    expect(names('snatch', {}, [...rows(), typo, placeholder])).toEqual(['Bo', 'Ada', 'Cy']);
  });
});

describe('pruning (`pruneBests`)', () => {
  const candidate = (name: string, value: number) => ({ value, row: row(name, '2026-01-01', 'M', "Open Men's 89kg", 88, [value, 0, 0], [0, 0, 0]) });

  it('drops only athletes strictly below the limit-th best, keeping ties', () => {
    const best = new Map(['a', 'b', 'c', 'd', 'e'].map((name, i) => [name, candidate(name, [100, 90, 80, 80, 70][i])]));
    pruneBests(best, 3);
    expect([...best.keys()]).toEqual(['a', 'b', 'c', 'd']);
    pruneBests(best, 10);
    expect(best.size).toBe(4);
    pruneBests(best, 1);
    expect([...best.keys()]).toEqual(['a']);
  });
});

describe('the guards and scores (the CLI’s `stats.rs`)', () => {
  const raw = (snatch: number[], cj: number[]) => row('A', '2026-04-04', 'M', "Men's 14-15 Age Group 79+kg", 90.8, snatch, cj);

  it('finds typo’d attempts, lifts over the world records and shifted totals', () => {
    const typo = raw([-63, 633, 65], [85, 90, -95]);
    expect(consistentTotal(typo)).toBe(true);
    expect(plausible(typo)).toBe(false);
    expect(rowSinclair(typo)).toBeNull();
    expect(plausible(raw([8686, 90, -93], [110, 0, 0]))).toBe(false);
    expect(plausible(raw([136, 0, 0], [136, 1411, 145]))).toBe(false);
    expect(plausible(raw([100, 200, 300], [100, 0, 0]))).toBe(false);
    expect(plausible(raw([200, 0, 0], [300, 0, 0]))).toBe(false);
    expect(plausible(raw([-60, 60, 66], [80, 85, -90]))).toBe(true);
    expect(plausible(raw([20, 25, 30], [25, 30, 0]))).toBe(true);
    expect(plausible(raw([225, 0, 0], [267, 0, 0]))).toBe(true);
    // The CLI's rules, not `lib/plausible.ts`'s: a total that is one lift adds up.
    expect(plausible({ ...raw([0, 0, 0], [90, 0, 0]), total: 90 })).toBe(true);
  });

  it('scores Sinclair with the 2021–24 coefficients', () => {
    expect(sinclair(300, 89, 'Men')).toBeCloseTo(362.63, 2);
    expect(sinclair(200, 64, 'Women')).toBeCloseTo(260.06, 2);
    expect(sinclair(300, 200, 'Men')).toBe(300);
    expect(sinclair(0, 89, 'Men')).toBeNull();
    expect(sinclair(200, 0, 'Women')).toBeNull();
    expect(sinclair(34, 0.9, 'Women')).toBeNull();
    expect(sinclair(148, 12, 'Men')).toBeNull();
  });

  it('scores Q-points with the published formula, at the floor bodyweight below it', () => {
    expect(qpoints(300, 89, 'Men')).toBeCloseTo(374.34, 2);
    expect(qpoints(200, 64, 'Women')).toBeCloseTo(270.48, 2);
    expect(qpoints(100, 45, 'Men')).toBe(qpoints(100, 50, 'Men'));
    expect(qpoints(100, 38, 'Women')).toBe(qpoints(100, 41, 'Women'));
    expect(qpoints(0, 89, 'Men')).toBeNull();
    expect(qpoints(148, 12, 'Men')).toBeNull();
  });

  it('scores a row by its division’s gender, and Q-points not for youth', () => {
    const youth = row('C', '2026-01-01', 'M', "Men's 16-17 Age Group 81kg", 80, [110, 0, 0], [140, 0, 0]);
    expect(rowQpoints(youth)).toBeNull();
    expect(rowSinclair(youth)).not.toBeNull();
    expect(rowQpoints(row('B', '2026-01-01', 'M', "Women's Masters (40-44) 69kg", 68, [70, 0, 0], [90, 0, 0]))).not.toBeNull();
    const mixed = row('A', '2025-06-01', 'M', "Men's/Women's Youth Under 12", 40, [30, 0, 0], [40, 0, 0]);
    expect(rowSinclair(mixed)).toBeNull();
    expect(rowSinclair({ ...mixed, age: "Girl's Development Under 12" })).not.toBeNull();
  });

  it('gives the CLI’s answers for the shared fixture (`cli/tests/fixtures/scores.json`)', () => {
    type Entry = {
      row: RankedFields;
      expected: { gender: string | null; category: string | null; plausible: boolean; sinclair: string | null; qpoints: string | null };
    };
    const fixture = JSON.parse(readFileSync(join(__dirname, '..', 'cli', 'tests', 'fixtures', 'scores.json'), 'utf8')) as { rows: Entry[] };
    expect(fixture.rows.length).toBeGreaterThan(200);
    // Scores travel as the shortest text that reads back as the same double.
    const score = (value: string | null) => (value === null ? null : Number(value));
    /** How many doubles apart `a` and `b` are (both positive). */
    const ulps = (a: number, b: number) => {
      const view = new DataView(new ArrayBuffer(16));
      view.setFloat64(0, a);
      view.setFloat64(8, b);
      return Number(view.getBigInt64(0) - view.getBigInt64(8));
    };
    let sinclairOff = 0;
    for (const { row, expected } of fixture.rows) {
      const division = parseDivision(row.age);
      const sinclair = rowSinclair(row);
      const wanted = score(expected.sinclair);
      // Q-points are + − × ÷ alone, so they are bit-for-bit. Sinclair goes through log10 and pow,
      // whose last bit V8 (Convex, Node) and the C library the CLI links can round differently.
      const close = sinclair !== null && wanted !== null && Math.abs(ulps(sinclair, wanted)) <= 2;
      if (close && sinclair !== wanted) sinclairOff += 1;
      expect([row.name, division.gender, division.category, plausible(row), close ? wanted : sinclair, rowQpoints(row)]).toEqual([
        row.name,
        expected.gender,
        expected.category,
        expected.plausible,
        wanted,
        score(expected.qpoints),
      ]);
    }
    // Most agree to the last bit; the rest only in it.
    expect(sinclairOff).toBeLessThanOrEqual(10);
  });

  it('parses divisions as the CLI does', () => {
    expect(parseDivision("Open Men's 89kg")).toEqual({ gender: 'Men', category: 'Senior' });
    expect(parseDivision("Women's Masters (40-44) +87kg")).toEqual({ gender: 'Women', category: 'Masters 40' });
    expect(parseDivision("Men's 16-17 Age Group 81kg").category).toBe('U17');
    expect(parseDivision("Women's 13 Under Age Group 40kg").category).toBe('U13');
    expect(parseDivision("Women's Youth Under 15 45Kg").category).toBe('U15');
    expect(parseDivision("Junior Women's 64kg").category).toBe('Junior');
    expect(parseDivision("Men's/Women's Youth Under 12")).toEqual({ gender: null, category: 'U13' });
    expect(parseDivision("Boy's Development Under 12")).toEqual({ gender: 'Men', category: 'U13' });
    expect(parseDivision("Men's/Women's Under 23").category).toBe('U23');
    expect(parseDivision("Women's Youth 49kg").category).toBe('U17');
  });

  it('takes the age categories the CLI takes', () => {
    expect(normalizeCategory('senior')).toBe('Senior');
    expect(normalizeCategory('Open')).toBe('Senior');
    expect(normalizeCategory('Youth')).toBe('U17');
    expect(normalizeCategory('u15')).toBe('U15');
    expect(normalizeCategory('Masters45')).toBe('Masters 45');
    expect(normalizeCategory('masters 35')).toBe('Masters 35');
    expect(normalizeCategory('Masters 37')).toBeNull();
    expect(normalizeCategory('Junk')).toBeNull();
  });
});

describe('the arguments', () => {
  const args = (extra: Partial<LeaderboardArgs> = {}): LeaderboardArgs => ({ from: '2025-01-01', to: '2025-12-31', by: 'total', ...extra });
  const statusOf = (extra: Partial<LeaderboardArgs>) => {
    try {
      checkLeaderboardArgs(args(extra));
      return 'ok';
    } catch (error) {
      if (error instanceof ConvexError) return (error.data as { status: number }).status;
      throw error;
    }
  };

  it('defaults the limit to 50, normalizes the category and trims the federation', () => {
    expect(checkLeaderboardArgs(args({ category: 'masters45', federation: ' USAW ' }))).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
      by: 'total',
      limit: 50,
      filters: { gender: undefined, category: 'Masters 45', division: undefined, federation: 'USAW', adaptive: false },
    });
  });

  it('refuses bad dates, a backwards range and one of five years or more', () => {
    expect(statusOf({ from: '2025-02-30' })).toBe(400);
    expect(statusOf({ to: 'soon' })).toBe(400);
    expect(statusOf({ from: '2025-06-01', to: '2025-05-31' })).toBe(400);
    expect(statusOf({ from: '2021-01-01', to: '2025-12-31' })).toBe('ok');
    expect(statusOf({ from: '2021-01-01', to: '2026-01-01' })).toBe(400);
    expect(statusOf({ from: '2020-02-29', to: '2025-02-28' })).toBe('ok');
  });

  it('caps the limit at 500', () => {
    expect(statusOf({ limit: 500 })).toBe('ok');
    expect(statusOf({ limit: 1 })).toBe('ok');
    for (const limit of [0, 501, 2.5, -1]) expect(statusOf({ limit })).toBe(400);
  });

  it('needs a gender for Sinclair and Q-points, and refuses an unknown category or a blank federation', () => {
    expect(statusOf({ by: 'sinclair' })).toBe(400);
    expect(statusOf({ by: 'qpoints' })).toBe(400);
    expect(statusOf({ by: 'qpoints', gender: 'Men' })).toBe('ok');
    expect(statusOf({ category: 'Masters 37' })).toBe(400);
    expect(statusOf({ federation: ' ' })).toBe(400);
  });

  it('reads a range in month slices covering every day once', () => {
    expect(monthSlices('2024-01-15', '2024-03-10')).toEqual([
      ['2024-01-15', '2024-01-31'],
      ['2024-02-01', '2024-02-29'],
      ['2024-03-01', '2024-03-10'],
    ]);
    expect(monthSlices('2025-12-31', '2026-01-01')).toEqual([
      ['2025-12-31', '2025-12-31'],
      ['2026-01-01', '2026-01-01'],
    ]);
    expect(monthSlices('2025-01-01', '2025-12-31')).toHaveLength(12);
  });
});

describe('results:leaderboard', () => {
  const NOW = Date.UTC(2026, 9, 13);
  const PASSES = [{ current: 'today', previous: 'yesterday', rotatedAt: NOW }];
  let log: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    setPremiumModeForTests(null);
    log.mockRestore();
  });

  /** A stored result (`lifting_results`), its total the sum of its lifts. */
  const stored = (name: string, date: string, snatch: number, cj: number, extra: Record<string, unknown> = {}) => ({
    eventId: 'e1',
    meet: `Meet ${date}`,
    date,
    name,
    age: "Open Men's 89kg",
    bodyWeight: 88,
    snatch1: snatch,
    snatchBest: snatch,
    cj1: cj,
    cjBest: cj,
    total: snatch + cj,
    adaptive: false,
    federation: 'USAW',
    ...extra,
  });

  function actionCtx(seed: Record<string, Record<string, unknown>[]>) {
    const { db } = fakeDb(seed);
    const handlers: Record<string, unknown> = { 'accessPass:passes': passes, 'results:leaderboardPage': leaderboardPage };
    const runQuery = jest.fn(async (ref: unknown, args: unknown) => handlerOf(handlers[getFunctionName(ref as never)])({ db }, args));
    return { ctx: { runQuery }, runQuery };
  }

  const run = (ctx: unknown, args: Record<string, unknown>) =>
    handlerOf<Record<string, unknown>, LeaderboardAnswer>(leaderboard)(ctx, { from: '2026-01-01', to: '2026-12-31', by: 'total', ...args });

  async function statusOf(promise: Promise<unknown>): Promise<number | 'ok'> {
    try {
      await promise;
      return 'ok';
    } catch (error) {
      if (error instanceof ConvexError) return (error.data as { status: number }).status;
      throw error;
    }
  }

  it('answers the ranked rows with the table’s fields, and the range’s federations', async () => {
    const { ctx } = actionCtx({
      access_passes: PASSES,
      lifting_results: [
        stored('Bo', '2026-02-01', 140, 175),
        stored('Ada', '2026-03-01', 100, 120),
        stored('Bo', '2026-04-01', 150, 180),
        stored('Ramiro', '2026-05-01', 170, 202, { federation: 'BWL', age: "Men's Senior 110Kg" }),
        stored('Old', '2025-12-31', 200, 240),
        stored('Blank', '2026-06-01', 10, 10, { federation: '' }),
      ],
    });
    const answer = await run(ctx, { pass: 'today' });
    expect(answer.federations).toEqual(['BWL', 'USAW']);
    expect(answer.rows.map((r) => [r.name, r.value])).toEqual([
      ['Bo', 330],
      ['Ada', 220],
      ['Blank', 20],
    ]);
    expect(answer.rows[0]).toEqual({
      name: 'Bo',
      date: '2026-04-01',
      meet: 'Meet 2026-04-01',
      age: "Open Men's 89kg",
      federation: 'USAW',
      body_weight: 88,
      snatch_best: 150,
      cj_best: 180,
      total: 330,
      sinclair: expect.any(Number),
      qpoints: expect.any(Number),
      value: 330,
    });
    expect((await run(ctx, { pass: 'today', federation: 'bwl' })).rows.map((r) => r.name)).toEqual(['Ramiro']);
    const women = await run(ctx, { pass: 'today', by: 'sinclair', gender: 'Women' });
    expect(women.rows).toEqual([]);
  });

  it('reads more than one page of a month, and every month, keeping each athlete once', async () => {
    const many = Array.from({ length: LEADERBOARD_PAGE_SIZE + 150 }, (_, i) => stored(`Lifter ${i % 1200}`, '2026-03-02', 50 + (i % 70), 60 + (i % 90)));
    const { ctx, runQuery } = actionCtx({
      access_passes: PASSES,
      lifting_results: [
        ...many,
        stored('Lifter 7', '2026-03-31', 200, 260),
        stored('Late', '2026-11-30', 190, 250),
      ],
    });
    const answer = await run(ctx, { pass: 'today', limit: 500 });
    const pages = runQuery.mock.calls.filter(([ref]) => getFunctionName(ref as never) === 'results:leaderboardPage');
    const march = pages.filter(([, args]) => (args as { start: string }).start === '2026-03-01');
    expect(march).toHaveLength(2);
    expect((march[1][1] as { cursor: string | null }).cursor).not.toBeNull();
    expect(pages).toHaveLength(13);
    expect(answer.rows).toHaveLength(500);
    expect(answer.rows.slice(0, 2).map((r) => [r.name, r.value, r.date])).toEqual([
      ['Lifter 7', 460, '2026-03-31'],
      ['Late', 440, '2026-11-30'],
    ]);
    expect(new Set(answer.rows.map((r) => r.name)).size).toBe(500);
  });

  it('keeps an athlete’s first row on a full tie across pages, as one pass over the rows would', async () => {
    const filler = Array.from({ length: LEADERBOARD_PAGE_SIZE - 1 }, (_, i) => stored(`F${i}`, '2026-03-02', 10, 10));
    const { ctx } = actionCtx({
      access_passes: PASSES,
      lifting_results: [stored('Tie', '2026-03-02', 100, 100, { meet: 'First' }), ...filler, stored('Tie', '2026-03-02', 100, 100, { meet: 'Second' })],
    });
    expect((await run(ctx, { pass: 'today', limit: 1 })).rows.map((r) => r.meet)).toEqual(['First']);
  });

  it('refuses without a current pass even in log mode: no client calls it without one, and each call is a full read', async () => {
    setPremiumModeForTests('log');
    const { ctx } = actionCtx({ access_passes: PASSES, lifting_results: [stored('Bo', '2026-02-01', 140, 175)] });
    expect(await statusOf(run(ctx, {}))).toBe(401);
    expect(await statusOf(run(ctx, { pass: 'last-week' }))).toBe(403);
    expect((await run(ctx, { pass: 'yesterday' })).rows).toHaveLength(1);
    expect(log).not.toHaveBeenCalled();
  });

  it('refuses without a pass (401) or with a stale one (403) in enforce mode, before reading any result', async () => {
    setPremiumModeForTests('enforce');
    const { ctx, runQuery } = actionCtx({ access_passes: PASSES, lifting_results: [stored('Bo', '2026-02-01', 140, 175)] });
    expect(await statusOf(run(ctx, {}))).toBe(401);
    expect(await statusOf(run(ctx, { pass: 'last-week' }))).toBe(403);
    expect(runQuery.mock.calls.map(([ref]) => getFunctionName(ref as never))).toEqual(['accessPass:passes', 'accessPass:passes']);
    expect(await statusOf(run(ctx, { pass: 'today' }))).toBe('ok');
    expect(await statusOf(run(actionCtx({}).ctx, { pass: 'today' }))).toBe(403);
  });

  it('gives up (500) on a month that never finishes paging, after LEADERBOARD_MAX_PAGES pages', async () => {
    const runQuery = jest.fn(async (ref: unknown) =>
      getFunctionName(ref as never) === 'accessPass:passes'
        ? { current: 'today', previous: null }
        : { json: '[]', isDone: false, continueCursor: 'more' },
    );
    expect(await statusOf(run({ runQuery }, { pass: 'today', from: '2026-03-01', to: '2026-03-31' }))).toBe(500);
    expect(runQuery).toHaveBeenCalledTimes(1 + LEADERBOARD_MAX_PAGES);
  });

  it('asks for pages by range and cursor alone, so every leaderboard shares them in the query cache', async () => {
    const { ctx, runQuery } = actionCtx({ access_passes: PASSES, lifting_results: [stored('Bo', '2026-02-01', 140, 175)] });
    await run(ctx, { pass: 'today', by: 'sinclair', gender: 'Men', federation: 'USAW', from: '2026-02-01', to: '2026-02-28' });
    expect(runQuery.mock.calls[1][1]).toEqual({ start: '2026-02-01', end: '2026-02-28', cursor: null });
  });

  it('answers as ranking every row at once would, while holding about `limit` athletes', async () => {
    // A seeded generator: many athletes over many pages and months, with ties of value and date.
    let seed = 7;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const months = ['01', '03', '05'];
    // About 2,300 rows a month: two pages each.
    const docs = Array.from({ length: 7000 }, () => {
      const month = months[random(months.length)];
      const date = `2026-${month}-${String(1 + random(3)).padStart(2, '0')}`;
      return stored(`Lifter ${random(900)}`, date, 60 + random(20) * 5, 80 + random(20) * 5, {
        meet: `Meet ${random(1000)}`,
        age: random(2) ? "Open Men's 89kg" : "Junior Women's 64kg",
        bodyWeight: 50 + random(60),
      });
    });
    const { ctx } = actionCtx({ access_passes: PASSES, lifting_results: docs });
    const inDateOrder = [...docs].map((doc, index) => ({ doc, index })).sort((a, b) => (a.doc.date < b.doc.date ? -1 : a.doc.date > b.doc.date ? 1 : a.index - b.index));
    const asRows: RankedFields[] = inDateOrder.map(({ doc }) => ({
      federation: doc.federation as string,
      meet: doc.meet as string,
      date: doc.date,
      name: doc.name,
      age: doc.age as string,
      body_weight: doc.bodyWeight as number,
      snatch1: doc.snatch1,
      snatch2: 0,
      snatch3: 0,
      snatch_best: doc.snatchBest,
      cj1: doc.cj1,
      cj2: 0,
      cj3: 0,
      cj_best: doc.cjBest,
      total: doc.total,
      adaptive: false,
    }));
    for (const [by, gender, limit] of [
      ['total', undefined, 5],
      ['snatch', undefined, 40],
      ['sinclair', 'Women', 25],
      ['qpoints', 'Men', 1],
    ] as const) {
      const answer = await run(ctx, { pass: 'today', from: '2026-01-01', to: '2026-06-30', by, gender, limit });
      const expected = rank(asRows, by, gender ? { gender } : {}, limit);
      expect([by, answer.rows.map((r) => [r.name, r.meet, r.date, r.value])]).toEqual([by, expected.map(({ row, value }) => [row.name, row.meet, row.date, value])]);
    }
  });

  it('refuses bad arguments with 400', async () => {
    const { ctx } = actionCtx({ access_passes: PASSES });
    expect(await statusOf(run(ctx, { pass: 'today', from: '2026-12-31', to: '2026-01-01' }))).toBe(400);
    expect(await statusOf(run(ctx, { pass: 'today', from: '2020-01-01', to: '2026-12-31' }))).toBe(400);
    expect(await statusOf(run(ctx, { pass: 'today', by: 'qpoints' }))).toBe(400);
    expect(await statusOf(run(ctx, { pass: 'today', limit: 501 }))).toBe(400);
  });
});
