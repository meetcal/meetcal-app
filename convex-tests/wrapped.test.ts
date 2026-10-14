import { ConvexError } from 'convex/values';
import { HISTORY_READY } from '../convex/lib/history';
import type { ApiLiftingResult } from '../convex/lib/results';
import { RESULT_NAMES_VIEW } from '../convex/lib/viewKeys';
import { textChunks, writeView } from '../convex/lib/views';
import { distinctLifts, MAX_WRAPPED_NAME_CHOICES, selectWrapped, type WrappedAnswer, wrappedStats } from '../convex/lib/wrapped';
import { MAX_SEARCH_RESULT_ROWS, WRAPPED_FALLBACK_NAMES, wrapped } from '../convex/results';
import { fakeMutationCtx, handlerOf } from './fakeDb';

/**
 * Weightlifting Wrapped is scored on the server (`convex/lib/wrapped.ts`,
 * `results:wrapped`). These are the rules the app's own scoring was held to
 * (`src/lib/wrapped-stats.test.ts`, `src/lib/wrapped-search.test.ts`), so
 * moving it changed no answer.
 */

/** A result row; an attempt of 0 was not taken, a negative one was missed. */
/**
 * A result row, consistent like real data: a total without its lifts gets a
 * snatch and clean & jerk that add up to it (`lib/plausible.ts` leaves out a
 * row whose numbers cannot be real), and lifts without a total get theirs.
 */
function row(overrides: Partial<ApiLiftingResult> = {}): ApiLiftingResult {
  const lifts: Partial<ApiLiftingResult> = {};
  if (overrides.total && overrides.snatch_best === undefined && overrides.cj_best === undefined) {
    lifts.snatch_best = Math.round(overrides.total * 0.45);
    lifts.cj_best = overrides.total - lifts.snatch_best;
  } else if (overrides.total === undefined && (overrides.snatch_best ?? 0) > 0 && (overrides.cj_best ?? 0) > 0) {
    lifts.total = (overrides.snatch_best ?? 0) + (overrides.cj_best ?? 0);
  }
  return {
    ...lifts,
    id: 1,
    event_id: 'e1',
    federation: 'USAW',
    meet: 'Test Open',
    date: '2026-03-01',
    name: 'Test Athlete',
    age: 'Open Men',
    body_weight: 81,
    snatch1: 0,
    snatch2: 0,
    snatch3: 0,
    snatch_best: 0,
    cj1: 0,
    cj2: 0,
    cj3: 0,
    cj_best: 0,
    total: 0,
    adaptive: false,
    ...lifts,
    ...overrides,
  };
}

describe('wrappedStats', () => {
  it('counts each miss once, so three makes and three misses is 50%', () => {
    const stats = wrappedStats([row({ snatch1: 100, snatch2: 105, snatch3: -110, cj1: 120, cj2: -125, cj3: -125 })]);
    expect(stats.makePercentage).toBe(50);
  });

  it('is 100% when every taken attempt was made', () => {
    const stats = wrappedStats([row({ snatch1: 100, snatch2: 105, cj1: 120, cj2: 125 })]);
    expect(stats.makePercentage).toBe(100);
    expect(stats.yearRank).toBe('Consistency King');
  });

  it('is 0% when every taken attempt was missed', () => {
    const stats = wrappedStats([row({ snatch1: -100, snatch2: -100, snatch3: -100 })]);
    expect(stats.makePercentage).toBe(0);
    expect(stats.totalWeightLifted).toBe(0);
  });

  it('ignores untaken attempts (0) in the denominator', () => {
    const stats = wrappedStats([row({ snatch1: 100, snatch2: -105, snatch3: 0, cj1: 0, cj2: 0, cj3: 0 })]);
    expect(stats.makePercentage).toBe(50);
  });

  it('reports no attempts as 0% rather than NaN', () => {
    expect(wrappedStats([row()]).makePercentage).toBe(0);
    expect(wrappedStats([]).makePercentage).toBe(0);
  });

  it('crosses the ELITE threshold at the real make rate', () => {
    // 8 makes / 10 taken attempts = 80%.
    const stats = wrappedStats([
      row({ snatch1: 100, snatch2: 105, snatch3: 110, cj1: 120, cj2: 125, cj3: 130 }),
      row({ snatch1: 100, snatch2: -105, snatch3: 110, cj1: -120 }),
    ]);
    expect(stats.makePercentage).toBeCloseTo(80, 5);
  });

  it('sums only made attempts into total weight lifted', () => {
    expect(wrappedStats([row({ snatch1: 100, snatch2: -105, cj1: 120 })]).totalWeightLifted).toBe(220);
  });

  it('tracks the longest make streak and breaks it on a miss', () => {
    const stats = wrappedStats([row({ snatch1: 100, snatch2: 105, snatch3: -110, cj1: 120, cj2: 125, cj3: 130 })]);
    expect(stats.longestMakeStreak).toBe(3);
  });

  it('does not break a make streak on an untaken attempt', () => {
    const stats = wrappedStats([row({ snatch1: 100, snatch2: 105, snatch3: 0, cj1: 120, cj2: 125 })]);
    expect(stats.longestMakeStreak).toBe(4);
  });

  it('picks the meet with the highest total and counts distinct meets', () => {
    const stats = wrappedStats([
      row({ meet: 'Local Open', total: 200 }),
      row({ meet: 'Nationals', total: 240 }),
      row({ meet: 'Nationals', total: 230 }),
    ]);
    expect(stats.topMeet).toBe('Nationals');
    expect(stats.totalMeets).toBe(2);
    expect(stats.bestTotal).toBe(240);
    expect(stats.averageTotal).toBeCloseTo(223.3333, 3);
  });

  it('gives a top-meet tie to the later meet, as the app did', () => {
    const stats = wrappedStats([
      row({ meet: 'Winter Open', date: '2026-01-10', total: 200 }),
      row({ meet: 'Summer Open', date: '2026-06-10', total: 200 }),
    ]);
    expect(stats.topMeet).toBe('Summer Open');
  });

  it('measures improvement from the first row to the last', () => {
    const stats = wrappedStats([
      row({ meet: 'Winter Open', date: '2026-01-10', total: 200 }),
      row({ meet: 'Summer Open', date: '2026-06-10', total: 225 }),
    ]);
    expect(stats.improvementFromFirst).toBe(25);
  });

  it('has no improvement when every total comes from one meet', () => {
    const stats = wrappedStats([row({ meet: 'Local Open', total: 200 }), row({ meet: 'Local Open', total: 210 })]);
    expect(stats.totalMeets).toBe(1);
    expect(stats.improvementFromFirst).toBeNull();
  });

  it("compares each meet's best total when a meet has several rows", () => {
    const stats = wrappedStats([
      row({ meet: 'Local Open', date: '2026-01-10', total: 200 }),
      row({ meet: 'Local Open', date: '2026-01-10', total: 205 }),
      row({ meet: 'Nationals', date: '2026-06-10', total: 230 }),
      row({ meet: 'Nationals', date: '2026-06-10', total: 220 }),
    ]);
    expect(stats.improvementFromFirst).toBe(25);
  });

  it('ignores a bomb-out at the end of the year', () => {
    const stats = wrappedStats([
      row({ meet: 'Winter Open', date: '2026-01-10', total: 200 }),
      row({ meet: 'Spring Open', date: '2026-04-10', total: 210 }),
      row({ meet: 'Fall Open', date: '2026-09-10', total: 0 }),
    ]);
    expect(stats.improvementFromFirst).toBe(10);
  });

  it('ignores a bomb-out at the start of the year', () => {
    const stats = wrappedStats([
      row({ meet: 'Winter Open', date: '2026-01-10', total: 0 }),
      row({ meet: 'Spring Open', date: '2026-04-10', total: 200 }),
      row({ meet: 'Fall Open', date: '2026-09-10', total: 195 }),
    ]);
    expect(stats.improvementFromFirst).toBe(-5);
  });

  it('has no improvement with fewer than two meets that have a total', () => {
    expect(
      wrappedStats([row({ meet: 'Winter Open', date: '2026-01-10', total: 0 }), row({ meet: 'Summer Open', date: '2026-06-10', total: 200 })])
        .improvementFromFirst,
    ).toBeNull();
    expect(wrappedStats([row({ total: 200 })]).improvementFromFirst).toBeNull();
    expect(wrappedStats([]).improvementFromFirst).toBeNull();
  });

  it('names the attempt number made most often', () => {
    expect(wrappedStats([row({ snatch2: 105, cj2: 125, snatch1: -100, cj1: -120 })]).favoriteAttempt).toBe(2);
  });

  it('breaks a favourite-attempt tie toward the earlier attempt', () => {
    const stats = wrappedStats([
      row({ meet: 'Winter Open', snatch1: 100, snatch2: 105, snatch3: -110, cj1: 120, cj2: -125, cj3: -125 }),
      row({ meet: 'Spring Open', date: '2026-04-01', snatch1: 100, snatch2: -105, snatch3: -105, cj1: 120, cj2: 125, cj3: -130 }),
    ]);
    // 1st: 4 makes, 2nd: 2 makes.
    expect(stats.favoriteAttempt).toBe(1);
    expect(wrappedStats([row({ snatch1: 100, snatch2: 105, cj1: -120, cj2: -125 })]).favoriteAttempt).toBe(1);
    expect(wrappedStats([row({ snatch2: 105, snatch3: 110, cj2: -125, cj3: -130 })]).favoriteAttempt).toBe(2);
  });

  it('has no favourite attempt when nothing was made', () => {
    expect(wrappedStats([row({ snatch1: -100, snatch2: -100, snatch3: -100 })]).favoriteAttempt).toBeNull();
    expect(wrappedStats([]).favoriteAttempt).toBeNull();
  });

  it('has no top meet when no row carries a total', () => {
    const stats = wrappedStats([row({ snatch1: 100 })]);
    expect(stats.topMeet).toBeNull();
    expect(stats.averageTotal).toBe(0);
  });

  it('counts each edition of a recurring meet as its own meet, so the first-to-last change keeps its sign', () => {
    const stats = wrappedStats([
      row({ meet: 'Monthly Open', date: '2026-01-10', total: 200 }),
      row({ meet: 'Summer Classic', date: '2026-06-10', total: 220 }),
      row({ meet: 'Monthly Open', date: '2026-12-10', total: 250 }),
    ]);
    expect(stats.totalMeets).toBe(3);
    expect(stats.improvementFromFirst).toBe(50);
    expect(stats.topMeet).toBe('Monthly Open');
  });

  it('counts one meet once however its name is cased or spaced', () => {
    const stats = wrappedStats([
      row({ meet: 'Spring Open', date: '2026-03-01', total: 200, snatch1: 90 }),
      row({ meet: 'spring open ', date: '2026-03-02', total: 210, snatch1: 95 }),
    ]);
    expect(stats.totalMeets).toBe(1);
    expect(stats.improvementFromFirst).toBeNull();
    expect(stats.topMeet).toBe('Spring Open');
  });

  it('leaves out a row whose numbers cannot be real, so a source typo is never a best', () => {
    const typo = row({ meet: 'Typo Open', date: '2026-04-01', snatch1: -63, snatch2: 633, snatch3: 65, snatch_best: 633, cj1: 80, cj_best: 80, total: 713 });
    const stats = wrappedStats([row({ meet: 'Real Open', date: '2026-03-01', total: 200 }), typo]);
    expect(stats).toMatchObject({ bestSnatch: 90, bestTotal: 200, totalMeets: 1, topMeet: 'Real Open' });
    expect(stats.yearRank).not.toBe('Heavy Hitter');
  });

  it('takes the year bests from the rows', () => {
    const stats = wrappedStats([
      row({ meet: 'A', date: '2026-01-01', snatch_best: 100, cj_best: 125, total: 225 }),
      row({ meet: 'B', date: '2026-02-01', snatch_best: 105, cj_best: 120, total: 225 }),
    ]);
    expect(stats).toMatchObject({ bestSnatch: 105, bestCleanJerk: 125, bestTotal: 225 });
  });

  it('counts a meet listed under two age divisions once', () => {
    const lift = { date: '2026-03-01', snatch1: 100, snatch2: 105, snatch3: 110, snatch_best: 110, cj1: 120, cj2: 125, cj3: 130, cj_best: 130, total: 240 };
    const stats = wrappedStats([row({ ...lift, meet: 'State Open', age: 'Junior' }), row({ ...lift, meet: 'State Open', age: 'Senior' })]);
    expect(stats.totalWeightLifted).toBe(690);
    expect(stats.longestMakeStreak).toBe(6);
    expect(stats.makePercentage).toBe(100);
    expect(stats.averageTotal).toBe(240);
    expect(stats.totalMeets).toBe(1);
  });

  it('counts one lift filed under two meet names on one date once', () => {
    const lift = { date: '2026-06-28', snatch1: 61, snatch2: -64, snatch3: -64, cj1: 81, cj2: -84, cj3: -87, total: 142 };
    const stats = wrappedStats([row({ ...lift, meet: 'National Youth Championships' }), row({ ...lift, meet: 'National Junior Championships' })]);
    expect(stats.totalWeightLifted).toBe(142);
    expect(stats.makePercentage).toBeCloseTo(100 / 3, 5);
    expect(stats.totalMeets).toBe(1);
    expect(stats.improvementFromFirst).toBeNull();
  });

  it('counts one meet listed under two dates once', () => {
    const lift = { meet: 'Summer Slam', snatch1: 60, cj1: 80, total: 140 };
    const stats = wrappedStats([row({ ...lift, date: '2026-05-16' }), row({ ...lift, date: '2026-05-19' })]);
    expect(stats.totalWeightLifted).toBe(140);
    expect(stats.averageTotal).toBe(140);
  });

  it('matches meet names trimmed and in any case', () => {
    const lift = { snatch1: 60, cj1: 80, total: 140 };
    expect(distinctLifts([row({ ...lift, meet: 'Summer Slam', date: '2026-05-16' }), row({ ...lift, meet: ' SUMMER slam ', date: '2026-05-20' })])).toHaveLength(1);
  });

  it('keeps two different lifts on one date, and the same numbers at two meets', () => {
    const stats = wrappedStats([
      row({ meet: 'A Open', date: '2026-03-01', snatch1: 100, total: 220 }),
      row({ meet: 'B Open', date: '2026-03-01', snatch1: 101, total: 221 }),
      row({ meet: 'C Open', date: '2026-08-01', snatch1: 100, total: 220 }),
    ]);
    expect(stats.totalWeightLifted).toBe(301);
    expect(stats.totalMeets).toBe(3);
  });

  it('keeps the same numbers at two editions of a recurring meet', () => {
    const lift = { meet: 'Local Open', snatch1: 45, cj1: 55, total: 100 };
    const stats = wrappedStats([row({ ...lift, date: '2026-04-11' }), row({ ...lift, date: '2026-05-09' })]);
    expect(stats.totalWeightLifted).toBe(200);
    expect(stats.makePercentage).toBe(100);
  });

  it('keeps rows with an unreadable date apart from a same-named meet', () => {
    const lift = { meet: 'Local Open', snatch1: 45, cj1: 55, total: 100 };
    expect(wrappedStats([row({ ...lift, date: '2026-04-11' }), row({ ...lift, date: '' })]).totalWeightLifted).toBe(200);
  });

  it('needs five distinct lifts, not five rows, to rank Meet Regular', () => {
    const lift = { snatch1: 50, snatch2: -55, cj1: 70, cj2: -75, total: 120 };
    const duplicated = [1, 2, 3].flatMap((month) => [
      row({ ...lift, meet: `Meet ${month}`, date: `2026-0${month}-01`, age: 'Junior' }),
      row({ ...lift, meet: `Meet ${month}`, date: `2026-0${month}-01`, age: 'Senior' }),
    ]);
    expect(wrappedStats(duplicated).yearRank).toBe('Rising Star');

    const distinct = [1, 2, 3, 4, 5].map((month) => row({ ...lift, meet: `Meet ${month}`, date: `2026-0${month}-01` }));
    expect(wrappedStats(distinct).yearRank).toBe('Meet Regular');
  });

  it('ranks a heavy but inconsistent year as Heavy Hitter', () => {
    const stats = wrappedStats([row({ snatch1: 140, snatch2: -145, cj1: 170, cj2: -175, total: 310 })]);
    expect(stats.makePercentage).toBe(50);
    expect(stats.yearRank).toBe('Heavy Hitter');
  });
});

let nextId = 1;
/** A one-athlete search row: a 2-for-2 lift at that date's meet. */
function searchRow(name: string, date: string, total = 200): ApiLiftingResult {
  const id = nextId++;
  return row({
    id,
    event_id: `e${id}`,
    meet: `Meet ${date}`,
    date,
    name,
    age: "Open Men's 89kg",
    body_weight: 88,
    snatch1: Math.round(total * 0.45),
    snatch_best: Math.round(total * 0.45),
    cj1: total - Math.round(total * 0.45),
    cj_best: total - Math.round(total * 0.45),
    total,
  });
}

const search = (overrides: { matched_name?: string | null; suggestions?: string[]; results?: ApiLiftingResult[]; truncated?: boolean }) =>
  selectWrapped({ matched_name: null, suggestions: [], results: [], truncated: false, ...overrides });

describe('selectWrapped', () => {
  it('scores every row of an exact match, in date order', () => {
    const rows = [searchRow('John Smith', '2025-06-01', 220), searchRow('John Smith', '2025-02-01', 200)];
    const answer = search({ matched_name: 'john smith', results: rows });
    expect(answer).toEqual({ kind: 'athlete', name: 'John Smith', stats: wrappedStats([rows[1], rows[0]]) });
    // Oldest first: +20kg, not -20kg.
    expect(answer.kind === 'athlete' && answer.stats.improvementFromFirst).toBe(20);
  });

  it('does not merge several athletes from the name-contains fallback', () => {
    const rows = [
      searchRow('John Smith', '2025-03-01', 300),
      searchRow('Jane Smith', '2025-01-01', 150),
      searchRow('JOHN  SMITH', '2025-05-01', 310),
      searchRow('Adam Smithers', '2025-04-01', 250),
    ];
    expect(search({ results: rows })).toEqual({ kind: 'ambiguous', names: ['Adam Smithers', 'Jane Smith', 'John Smith'], truncated: false });
  });

  it('accepts the fallback when its rows are one athlete (spelling variants included)', () => {
    const rows = [searchRow('Jane Doe', '2025-05-01', 220), searchRow('jane  doe ', '2025-01-01', 200)];
    expect(search({ results: rows })).toEqual({ kind: 'athlete', name: 'Jane Doe', stats: wrappedStats([rows[1], rows[0]]) });
  });

  it('drops blank-named rows rather than scoring them with the one athlete', () => {
    const rows = [searchRow('Jane Doe', '2025-05-01'), searchRow('', '2025-01-01')];
    const answer = search({ results: rows });
    expect(answer).toEqual({ kind: 'athlete', name: 'Jane Doe', stats: wrappedStats([rows[0]]) });
    expect(answer.kind === 'athlete' && answer.stats.totalMeets).toBe(1);
  });

  it('answers none, with the search suggestions, for no rows or only blank names', () => {
    expect(search({ suggestions: ['Jon Smith'] })).toEqual({ kind: 'none', suggestions: ['Jon Smith'] });
    expect(search({ matched_name: 'x' })).toEqual({ kind: 'none', suggestions: [] });
    expect(search({ results: [searchRow('  ', '2025-01-01')] })).toEqual({ kind: 'none', suggestions: [] });
  });

  it('refuses to score an exact match whose year was cut', () => {
    const rows = [searchRow('John Smith', '2025-02-01'), searchRow('John Smith', '2025-06-01')];
    expect(search({ matched_name: 'john smith', results: rows, truncated: true })).toEqual({ kind: 'tooManyResults', name: 'John Smith' });
  });

  it('offers the one athlete of a cut fallback to pick, not as the match', () => {
    expect(search({ results: [searchRow('Jane Doe', '2025-05-01')], truncated: true })).toEqual({ kind: 'ambiguous', names: ['Jane Doe'], truncated: true });
  });

  it('asks to narrow, not "no results", when a cut fallback found nobody in the year', () => {
    expect(search({ truncated: true })).toEqual({ kind: 'narrow' });
    expect(search({ results: [searchRow(' ', '2025-01-01')], truncated: true })).toEqual({ kind: 'narrow' });
  });

  it('caps the name choices, and says more matched', () => {
    const many = Array.from({ length: MAX_WRAPPED_NAME_CHOICES + 3 }, (_, i) => searchRow(`Athlete ${String(i).padStart(2, '0')} Smith`, '2025-01-01'));
    const answer = search({ results: many });
    expect(answer.kind === 'ambiguous' && answer.names).toHaveLength(MAX_WRAPPED_NAME_CHOICES);
    expect(answer.kind === 'ambiguous' && answer.truncated).toBe(true);

    const exactly = search({ results: many.slice(0, MAX_WRAPPED_NAME_CHOICES) });
    expect(exactly.kind === 'ambiguous' && exactly.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// `results:wrapped`
// ---------------------------------------------------------------------------

/** A newest-first history, as the history documents hold it. */
const historyOf = (rows: ApiLiftingResult[]) => [...rows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

const HISTORIES: Record<string, ApiLiftingResult[]> = {
  'Ann Lee': [searchRow('Ann Lee', '2025-12-31', 180), searchRow('Ann Lee', '2026-02-01', 200), searchRow('Ann Lee', '2026-08-01', 210)],
  'Ann Smith': [searchRow('Ann Smith', '2025-05-01')],
  'Ann Smithers': [searchRow('Ann Smithers', '2026-05-01')],
  'Bob Smith': [searchRow('Bob Smith', '2026-03-01')],
  'Cal Busy': Array.from({ length: MAX_SEARCH_RESULT_ROWS + 1 }, (_, i) => searchRow('Cal Busy', `2026-01-${String((i % 28) + 1).padStart(2, '0')}`)),
};

const getUserIdentity = jest.fn(async () => {
  throw new Error('results:wrapped must not read the caller');
});

async function harness() {
  const fake = fakeMutationCtx({
    data_versions: [{ table: HISTORY_READY, version: 1 }],
    athlete_history: Object.entries(HISTORIES).map(([name, rows]) => ({ nameKey: name.toLowerCase(), json: JSON.stringify(historyOf(rows)) })),
  });
  await writeView(fake.ctx as never, RESULT_NAMES_VIEW, textChunks(Object.keys(HISTORIES).join('\n')), [], { text: true });
  return { ...fake.ctx, auth: { getUserIdentity } };
}

const ask = async (args: { query: string; year: number; picked?: boolean }) =>
  await handlerOf<typeof args, WrappedAnswer>(wrapped)(await harness(), args);

async function statusOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    if (error instanceof ConvexError) return (error.data as { status: number }).status;
    throw error;
  }
}

describe('results:wrapped', () => {
  beforeEach(() => getUserIdentity.mockClear());
  afterEach(() => expect(getUserIdentity).not.toHaveBeenCalled());

  it('takes only a whole, four-digit-range year and a query', async () => {
    expect(await statusOf(ask({ query: 'Ann Lee', year: 99 }))).toBe(400);
    expect(await statusOf(ask({ query: 'Ann Lee', year: 2026.5 }))).toBe(400);
    expect(await statusOf(ask({ query: 'Ann Lee', year: 1899 }))).toBe(400);
    expect(await statusOf(ask({ query: 'Ann Lee', year: 2101 }))).toBe(400);
    expect(await statusOf(ask({ query: 'Ann Lee', year: Number.NaN }))).toBe(400);
    expect(await statusOf(ask({ query: '  ', year: 2026 }))).toBe(400);
    expect(await statusOf(ask({ query: 'Ann Lee', year: 1900 }))).toBe('resolved');
    expect(await statusOf(ask({ query: 'Ann Lee', year: 2100 }))).toBe('resolved');
  });

  it("scores an exact name's calendar year only, under the athlete's spelling, with no pass or sign-in", async () => {
    const answer = await ask({ query: 'ann lee', year: 2026 });
    expect(answer).toEqual({ kind: 'athlete', name: 'Ann Lee', stats: wrappedStats(HISTORIES['Ann Lee'].slice(1)) });
    expect(answer.kind === 'athlete' && answer.stats.improvementFromFirst).toBe(10);
  });

  it('falls back to the name-contains search without a pick', async () => {
    expect(await ask({ query: 'smith', year: 2026 })).toEqual({ kind: 'ambiguous', names: ['Ann Smithers', 'Bob Smith'], truncated: false });
    // Ann Smith is an athlete who did not lift in 2026: no Wrapped, rather than someone else's.
    expect(await ask({ query: 'Ann Smith', year: 2026 })).toEqual({ kind: 'none', suggestions: ['Ann Smith', 'Ann Smithers'] });
  });

  it('asks for more of the name, without reading any history, when the name matches too many athletes', async () => {
    const names = Array.from({ length: WRAPPED_FALLBACK_NAMES }, (_, i) => `Many Lifter ${String(i).padStart(3, '0')}`);
    const fake = fakeMutationCtx({ data_versions: [{ table: HISTORY_READY, version: 1 }] });
    await writeView(fake.ctx as never, RESULT_NAMES_VIEW, textChunks(names.join('\n')), [], { text: true });
    const before = fake.reads.count;
    const answer = await handlerOf<Record<string, unknown>, WrappedAnswer>(wrapped)({ ...fake.ctx, auth: { getUserIdentity } }, { query: 'lifter', year: 2026 });
    expect(answer).toEqual({ kind: 'narrow' });
    expect(fake.docs('athlete_history')).toEqual([]);
    // The name directory, not a thousand histories.
    expect(fake.reads.count - before).toBeLessThan(20);
  });

  it('takes only the exact name with picked, never the fallback', async () => {
    expect(await ask({ query: 'Bob Smith', year: 2026, picked: true })).toMatchObject({ kind: 'athlete', name: 'Bob Smith' });
    expect(await ask({ query: 'Ann Smith', year: 2026, picked: true })).toEqual({ kind: 'none', suggestions: ['Ann Smith', 'Ann Smithers'] });
    expect(await ask({ query: 'smith', year: 2026, picked: true })).toEqual({ kind: 'none', suggestions: ['Ann Smith', 'Ann Smithers', 'Bob Smith'] });
  });

  it('answers none with suggestions for a name without results in the year', async () => {
    expect(await ask({ query: 'Ann Lee', year: 2024 })).toEqual({ kind: 'none', suggestions: ['Ann Lee'] });
    expect(await ask({ query: 'Zed Nobody', year: 2026 })).toEqual({ kind: 'none', suggestions: [] });
  });

  it('refuses a year with more results than one search answer holds', async () => {
    expect(await ask({ query: 'Cal Busy', year: 2026 })).toEqual({ kind: 'tooManyResults', name: 'Cal Busy' });
  });
});
