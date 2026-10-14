import { v } from 'convex/values';
import { checkPass, premiumQuery, premiumRead } from './lib/access';
import { action, internalQuery, query, type QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import { nameMatcher, queryBigrams, searchDirectory } from './lib/directory';
import { readHistories, readSummaries, type Mark, type Summary } from './lib/history';
import {
  addBests,
  type Candidate,
  checkLeaderboardArgs,
  type LeaderboardRow,
  leaderboardRow,
  monthSlices,
  parseCompactRows,
  pruneBests,
  rankBests,
  toCompactRow,
} from './lib/leaderboard';
import { computeMeetResults } from './lib/meetData';
import { cleanNameList, distinctNameKeys, normalizeName, requestedNamesByKey } from './lib/names';
import {
  bestsSince,
  namedBests,
  toApiLiftingResult,
  ZERO_BESTS,
  type ApiLiftingResult,
  type NamedBests,
  type YearBests,
} from './lib/results';
import { compareBytes } from './lib/sort';
import { selectWrapped, type WrappedAnswer } from './lib/wrapped';
import { RESULT_NAMES_VIEW, SEARCH_SHARD_SIZES_VIEW, searchShardKey } from './lib/viewKeys';
import { readViewJsonAnyAge, readViewTextAnyAge } from './lib/views';
import { apiError, requireIsoDate, requireNameList, requireNonEmpty, requirePresentIsoDate } from './lib/validation';

// `/lifting-results/*` and `/search`: each query answers the JSON of the Rust
// route of the same name. Per-athlete reads go through the athlete history
// documents (`lib/history.ts`): one document per name instead of one per
// result. Row lists travel as JSON text (`{ json }`).

export const MAX_LIMIT_PER_NAME = 200;

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

/** Results one `leaderboardPage` read covers. */
export const LEADERBOARD_PAGE_SIZE = 2000;
/** Month slices of a leaderboard's range read side by side, each its own cursor chain. */
export const LEADERBOARD_CONCURRENCY = 8;
/** Most pages one month slice is read in before the leaderboard gives up (2,000 rows each). */
export const LEADERBOARD_MAX_PAGES = 50;

const metricArg = v.union(v.literal('total'), v.literal('snatch'), v.literal('cj'), v.literal('sinclair'), v.literal('qpoints'));
const genderArg = v.union(v.literal('Men'), v.literal('Women'));

/** One page of a leaderboard's read: its rows as JSON text of `CompactRow`s. */
export type LeaderboardPage = { json: string; isDone: boolean; continueCursor: string };

/**
 * One page of the results dated `start` to `end`, by date, as compact rows
 * (`lib/leaderboard.ts`). It takes nothing about the leaderboard asked for
 * and reads no pass, so Convex caches each page once for every caller,
 * metric and filter: a past month's pages are read from the database once
 * until its results change.
 */
export const leaderboardPage = internalQuery({
  args: { start: v.string(), end: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { start, end, cursor }): Promise<LeaderboardPage> => {
    const result = await ctx.db
      .query('lifting_results')
      .withIndex('by_date', (q) => q.gte('date', start).lte('date', end))
      .paginate({ cursor, numItems: LEADERBOARD_PAGE_SIZE });
    return {
      json: JSON.stringify(result.page.map((row) => toCompactRow(toApiLiftingResult(row)))),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** A leaderboard: `rows` best first, and the federations in the range (`federations`, sorted, non-blank). */
export type LeaderboardAnswer = { rows: LeaderboardRow[]; federations: string[] };

/**
 * The leaderboard of every athlete in a date range (`lib/leaderboard.ts`):
 * each athlete once, by their best `by` (`total`, `snatch`, `cj`, `sinclair`
 * or `qpoints`), best first, at most `limit` (default 50, at most 500).
 * Filters: `gender` (needed for `sinclair` and `qpoints`), `category`,
 * `division` (text it contains), `federation` (BWL is left out unless
 * asked for) and `adaptive` (left out unless true). The range spans less
 * than five years. Premium: an action (it reads every result in the range,
 * a page per internal query), so it takes the pass itself (`PREMIUM_ACTIONS`).
 */
export const leaderboard = action({
  args: {
    from: v.string(),
    to: v.string(),
    by: metricArg,
    gender: v.optional(genderArg),
    category: v.optional(v.string()),
    division: v.optional(v.string()),
    federation: v.optional(v.string()),
    adaptive: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    pass: v.optional(v.string()),
  },
  handler: async (ctx, { pass, ...args }): Promise<LeaderboardAnswer> => {
    checkPass('results:leaderboard', pass, await ctx.runQuery(internal.accessPass.passes, {}));
    const { from, to, by, limit, filters } = checkLeaderboardArgs(args);
    const slices = monthSlices(from, to);
    // Folded in as pages arrive and pruned to about `limit` athletes. Slices finish in any
    // order, but that cannot change the answer: rows from different months differ in date,
    // which ties are broken by, and a month's own pages are folded in date order, so a full
    // tie keeps the row read first, as one pass over the rows would.
    const best = new Map<string, Candidate>();
    const federations = new Set<string>();
    const readSlice = async (index: number) => {
      const [start, end] = slices[index];
      let cursor: string | null = null;
      for (let pages = 0; pages < LEADERBOARD_MAX_PAGES; pages++) {
        const page: LeaderboardPage = await ctx.runQuery(internal.results.leaderboardPage, { start, end, cursor });
        const rows = parseCompactRows(page.json);
        for (const row of rows) federations.add(row.federation);
        addBests(best, rows, by, filters);
        pruneBests(best, limit);
        if (page.isDone) return;
        cursor = page.continueCursor;
      }
      throw apiError(500, `results from ${start} to ${end} did not finish within ${LEADERBOARD_MAX_PAGES} pages`);
    };
    let next = 0;
    const worker = async () => {
      while (next < slices.length) await readSlice(next++);
    };
    await Promise.all(Array.from({ length: Math.min(LEADERBOARD_CONCURRENCY, slices.length) }, worker));
    return {
      rows: rankBests(best.values(), limit).map(leaderboardRow),
      federations: [...federations].filter((federation) => federation.trim() !== '').sort(compareBytes),
    };
  },
});

/** `GET /lifting-results`: a meet's results, by name. Answers `{ json }`. */
export const byMeet = premiumQuery('results:byMeet', {
  args: { meet: v.string() },
  handler: async (ctx, { meet }) => {
    requireNonEmpty('meet', meet);
    return { json: JSON.stringify(await computeMeetResults(ctx, meet)) };
  },
});

/** Newest first across athletes (a stable sort keeps each athlete's own order). */
function newestFirst(rows: ApiLiftingResult[]): ApiLiftingResult[] {
  return rows.sort((a, b) => compareBytes(b.date, a.date));
}

/** A newest-first history cut at `cutoff` (inclusive). */
function since(history: readonly ApiLiftingResult[], cutoff: string): ApiLiftingResult[] {
  const rows: ApiLiftingResult[] = [];
  for (const row of history) {
    if (row.date < cutoff) break;
    rows.push(row);
  }
  return rows;
}

type Histories = Map<string, ApiLiftingResult[]>;

export function answerByNames(histories: Histories, latestOnly: boolean, limit: number | undefined): string {
  const rows: ApiLiftingResult[] = [];
  for (const history of histories.values()) {
    let kept = history;
    if (latestOnly && kept.length > 0) kept = kept.filter((row) => row.date === history[0].date);
    if (limit !== undefined) kept = kept.slice(0, limit);
    rows.push(...kept);
  }
  return JSON.stringify(newestFirst(rows));
}

export function answerRecent(histories: Histories, cutoff: string): string {
  const rows: ApiLiftingResult[] = [];
  for (const history of histories.values()) rows.push(...since(history, cutoff));
  return JSON.stringify(newestFirst(rows));
}

export function answerBests(summaries: Map<string, Summary>, names: readonly string[], cutoff: string): NamedBests[] {
  const bestByKey = new Map<string, YearBests>();
  for (const [key, { marks }] of summaries) {
    const bests = bestsSince(marks, cutoff);
    if (bests) bestByKey.set(key, bests);
  }
  return namedBests(names, bestByKey);
}

export function answerYearBests(marks: readonly Mark[], cutoff: string): YearBests {
  return bestsSince(marks, cutoff) ?? ZERO_BESTS;
}

/** `answerByNames` with `latestOnly`, from the summaries' latest rows. */
export function answerLatest(summaries: Map<string, Summary>, limit: number | undefined): string {
  const rows: ApiLiftingResult[] = [];
  for (const { latest } of summaries.values()) rows.push(...(limit === undefined ? latest : latest.slice(0, limit)));
  return JSON.stringify(newestFirst(rows));
}

function checkLimit(limit: number | undefined): void {
  if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1 && limit <= MAX_LIMIT_PER_NAME)) {
    throw apiError(400, `limit_per_name must be between 1 and ${MAX_LIMIT_PER_NAME}`);
  }
}

/**
 * `POST /lifting-results/by-names`: every result for the names, newest first.
 * `latestOnly` keeps each athlete's most recent meet date; `limitPerName`
 * caps each athlete's rows (newest first). Answers `{ json }`.
 */
export const byNames = premiumQuery('results:byNames', {
  args: {
    names: v.array(v.string()),
    latestOnly: v.optional(v.boolean()),
    limitPerName: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const names = cleanNameList(args.names);
    requireNameList(names);
    checkLimit(args.limitPerName);
    const keys = distinctNameKeys(names);
    if (args.latestOnly) return { json: answerLatest(await readSummaries(ctx, keys), args.limitPerName) };
    return { json: answerByNames(await readHistories(ctx, keys), false, args.limitPerName) };
  },
});

/** `POST /lifting-results/recent`: results since `cutoffDate`, newest first. Answers `{ json }`. */
export const recent = premiumQuery('results:recent', {
  args: { names: v.array(v.string()), cutoffDate: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const names = cleanNameList(args.names);
    requireNameList(names);
    const cutoff = requirePresentIsoDate('cutoff_date', args.cutoffDate);
    return { json: answerRecent(await readHistories(ctx, distinctNameKeys(names)), cutoff) };
  },
});

/** `GET /lifting-results/year`: one athlete's bests since `cutoffDate`. */
export const yearBests = premiumQuery('results:yearBests', {
  args: { name: v.string(), cutoffDate: v.optional(v.string()) },
  handler: async (ctx, args): Promise<YearBests> => {
    requireNonEmpty('name', args.name);
    const cutoff = requirePresentIsoDate('cutoff_date', args.cutoffDate);
    const key = normalizeName(args.name);
    return answerYearBests((await readSummaries(ctx, [key])).get(key)?.marks ?? [], cutoff);
  },
});

/**
 * `POST /lifting-results/bests`: bests since `cutoffDate` for each requested
 * spelling (unknown names get zeros), as a list in byte order of name; see
 * `NamedBests` for why not a name-keyed map.
 */
export const bests = premiumQuery('results:bests', {
  args: { names: v.array(v.string()), cutoffDate: v.optional(v.string()) },
  handler: async (ctx, args): Promise<NamedBests[]> => {
    const names = cleanNameList(args.names);
    requireNameList(names);
    const cutoff = requirePresentIsoDate('cutoff_date', args.cutoffDate);
    const summaries = await readSummaries(ctx, [...requestedNamesByKey(names).keys()]);
    return answerBests(summaries, names, cutoff);
  },
});

// ---------------------------------------------------------------------------
// `GET /search`
// ---------------------------------------------------------------------------

/**
 * The most results one `results:search` answer holds. When more match, it
 * keeps the most recent and says so (`truncated`).
 */
export const MAX_SEARCH_RESULT_ROWS = 600;
const MAX_SEARCH_SUGGESTIONS = 8;
/**
 * A one- or two-letter query matches most of the directory. Postgres scans the
 * table for those; here the fallback reads the first this-many matching
 * athletes in name order.
 */
const MAX_FALLBACK_NAMES = 1000;

async function directory(ctx: QueryCtx): Promise<string> {
  const text = await readViewTextAnyAge(ctx, RESULT_NAMES_VIEW);
  if (text === null) throw apiError(503, 'search directory is not built yet');
  return text;
}

/**
 * The names a query can match: the shard of its rarest two-letter sequence
 * when it has one (`lib/directory.ts`), otherwise the whole directory. A
 * sequence no name contains means no match at all.
 */
async function searchText(ctx: QueryCtx, query: string): Promise<string> {
  const bigrams = queryBigrams(query);
  if (bigrams) {
    const sizesText = await readViewJsonAnyAge(ctx, SEARCH_SHARD_SIZES_VIEW);
    if (sizesText !== null) {
      const sizes = new Map(JSON.parse(sizesText) as [string, number][]);
      let rarest: string | null = null;
      for (const bigram of bigrams) {
        const size = sizes.get(bigram) ?? 0;
        if (size === 0) return '';
        if (rarest === null || size < (sizes.get(rarest) ?? 0)) rarest = bigram;
      }
      if (rarest !== null) {
        const shard = await readViewTextAnyAge(ctx, searchShardKey(rarest));
        if (shard !== null) return shard;
      }
    }
  }
  return await directory(ctx);
}

/** Rows dated `start` to `end`, both inclusive, oldest first. */
function inRange(history: readonly ApiLiftingResult[], start: string, end: string): ApiLiftingResult[] {
  return history.filter((row) => row.date >= start && row.date <= end).reverse();
}

/**
 * A `results:search` answer. `truncated` says more results match than it
 * holds: it keeps the most recent `MAX_SEARCH_RESULT_ROWS`, and a client
 * should ask for a narrower search to see the rest.
 */
export type SearchAnswer = {
  matched_name: string | null;
  suggestions: string[];
  results: ApiLiftingResult[];
  truncated: boolean;
};

/** Oldest-first `rows` cut to the most recent `MAX_SEARCH_RESULT_ROWS`, still oldest first. */
function mostRecent(rows: ApiLiftingResult[]): { results: ApiLiftingResult[]; truncated: boolean } {
  if (rows.length <= MAX_SEARCH_RESULT_ROWS) return { results: rows, truncated: false };
  return { results: rows.slice(rows.length - MAX_SEARCH_RESULT_ROWS), truncated: true };
}

/** The exact name's answer from its newest-first history, or null when it has no result in the range. */
export function exactSearchAnswer(
  query: string,
  history: readonly ApiLiftingResult[],
  start: string,
  end: string,
): SearchAnswer | null {
  const rows = inRange(history, start, end);
  if (rows.length === 0) return null;
  return { matched_name: query, suggestions: [], ...mostRecent(rows) };
}

/**
 * Every matching name's results in the range, oldest first, from the
 * histories of `matched` (the directory's first `MAX_FALLBACK_NAMES` matches;
 * reaching that many means more names may match, so the answer is truncated).
 */
export function fallbackSearchAnswer(
  query: string,
  matched: readonly string[],
  histories: Histories,
  start: string,
  end: string,
): SearchAnswer {
  const matches = nameMatcher(query);
  const rows: ApiLiftingResult[] = [];
  for (const history of histories.values()) {
    for (const row of inRange(history, start, end)) {
      if (matches(row.name)) rows.push(row);
    }
  }
  rows.sort((a, b) => compareBytes(a.date, b.date));
  const { results, truncated } = mostRecent(rows);
  return {
    matched_name: null,
    suggestions: matched.slice(0, MAX_SEARCH_SUGGESTIONS),
    results,
    truncated: truncated || matched.length >= MAX_FALLBACK_NAMES,
  };
}

/**
 * `GET /search`: without dates, name suggestions (`ILIKE '%query%'`). With
 * dates (`startDate` to `endDate`, both inclusive), the exact (case- and
 * whitespace-folded) name's results in the range, or, failing that, every
 * matching name's results plus suggestions. Results are oldest first, at most
 * `MAX_SEARCH_RESULT_ROWS` of them; see `SearchAnswer`.
 */
export const search = query({
  args: {
    query: v.string(),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    // The access pass (`lib/access.ts`), for results.
    pass: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SearchAnswer> => {
    requireNonEmpty('query', args.query);
    requireIsoDate('start_date', args.startDate);
    requireIsoDate('end_date', args.endDate);
    const matchingNames = async (limit: number) => searchDirectory(await searchText(ctx, args.query), args.query, limit);

    if (args.startDate === undefined || args.endDate === undefined) {
      return { matched_name: null, suggestions: await matchingNames(MAX_SEARCH_SUGGESTIONS), results: [], truncated: false };
    }
    // Results are premium; name suggestions alone are not.
    await premiumRead(ctx, 'results:search', args.pass);
    if (args.endDate < args.startDate) throw apiError(400, 'end_date must not be before start_date');
    return await datedSearch(ctx, args.query, args.startDate, args.endDate);
  },
});

/**
 * The dated search behind `search` and `wrapped`: the exact (folded) name's
 * results in the range, or, failing that, every matching name's results plus
 * suggestions. With `exactOnly`, no fallback: just the suggestions.
 */
async function datedSearch(
  ctx: QueryCtx,
  query: string,
  start: string,
  end: string,
  {
    exactOnly = false,
    fallbackNames = MAX_FALLBACK_NAMES,
    fallbackForKnownName = true,
  }: { exactOnly?: boolean; fallbackNames?: number; fallbackForKnownName?: boolean } = {},
): Promise<SearchAnswer> {
  const exactKey = normalizeName(query);
  const history = (await readHistories(ctx, [exactKey])).get(exactKey) ?? [];
  const exact = exactSearchAnswer(query, history, start, end);
  if (exact) return exact;
  // `exactOnly`, or (unless `fallbackForKnownName`) the exact name is an
  // athlete with no results in the range: no fallback, which would show
  // someone else.
  if (exactOnly || (!fallbackForKnownName && history.length > 0)) {
    const suggestions = searchDirectory(await searchText(ctx, query), query, MAX_SEARCH_SUGGESTIONS);
    return { matched_name: null, suggestions, results: [], truncated: false };
  }
  const matched = searchDirectory(await searchText(ctx, query), query, fallbackNames);
  // As many names as the cap: more may match. Ask for more of the name before reading their histories.
  if (fallbackNames < MAX_FALLBACK_NAMES && matched.length >= fallbackNames) {
    return { matched_name: null, suggestions: matched.slice(0, MAX_SEARCH_SUGGESTIONS), results: [], truncated: true };
  }
  return fallbackSearchAnswer(query, matched, await readHistories(ctx, distinctNameKeys(matched)), start, end);
}

/** The earliest and latest years `wrapped` answers for. */
export const WRAPPED_YEARS = { first: 1900, last: 2100 } as const;
/**
 * The most names a Wrapped's name-contains fallback reads histories for. It
 * offers at most `MAX_WRAPPED_NAME_CHOICES`; a query matching more names asks
 * for more of the name before reading any history, which keeps this public
 * query cheap.
 */
export const WRAPPED_FALLBACK_NAMES = 100;

/**
 * Weightlifting Wrapped for `query`'s calendar `year` (`lib/wrapped.ts`): the
 * year's stats, never the results behind them, so it is free and public.
 * Answers `{ kind }`: `athlete` with `name` and `stats`, `ambiguous` with the
 * `names` to pick from (ask again with `picked`, which only takes the exact
 * name), `narrow`, `tooManyResults`, or `none` with name `suggestions`.
 */
export const wrapped = query({
  args: { query: v.string(), year: v.number(), picked: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<WrappedAnswer> => {
    requireNonEmpty('query', args.query);
    if (!Number.isInteger(args.year) || args.year < WRAPPED_YEARS.first || args.year > WRAPPED_YEARS.last) {
      throw apiError(400, 'year must be a four-digit year');
    }
    const answer = await datedSearch(ctx, args.query, `${args.year}-01-01`, `${args.year}-12-31`, {
      exactOnly: args.picked === true,
      fallbackNames: WRAPPED_FALLBACK_NAMES,
      fallbackForKnownName: false,
    });
    return selectWrapped(answer);
  },
});
