import { v } from 'convex/values';
import { query, type QueryCtx } from './_generated/server';
import { nameMatcher, queryBigrams, searchDirectory } from './lib/directory';
import { readHistories, readSummaries, type Mark, type Summary } from './lib/history';
import { computeMeetResults } from './lib/meetData';
import { cleanNameList, distinctNameKeys, normalizeName, requestedNamesByKey } from './lib/names';
import { toApiLiftingResult, ZERO_BESTS, type ApiLiftingResult, type NamedBests, type YearBests } from './lib/results';
import { compareBytes } from './lib/sort';
import { RESULT_NAMES_VIEW, SEARCH_SHARD_SIZES_VIEW, searchShardKey } from './lib/viewKeys';
import { readViewJsonAnyAge, readViewTextAnyAge } from './lib/views';
import { apiError, requireIsoDate, requireNameList, requireNonEmpty, requirePresentIsoDate } from './lib/validation';

// `/lifting-results/*` and `/search`: each query answers the JSON of the Rust
// route of the same name. Per-athlete reads go through the athlete history
// documents (`lib/history.ts`): one document per name instead of one per
// result. Row lists travel as JSON text (`{ json }`).

export const MAX_LIMIT_PER_NAME = 200;

/** Rows per `results:page` call, unless the caller asks for fewer. */
export const RESULTS_PAGE_SIZE = 1000;
/** The most rows one `results:page` call returns. */
export const MAX_RESULTS_PAGE_SIZE = 2000;

/**
 * Every result dated `startDate` to `endDate` (inclusive), oldest first, a page at a time: pass
 * back `continueCursor` until `isDone`. For clients that compute across all results (the CLI's
 * leaderboards and exports). Answers `{ json, isDone, continueCursor }`, the rows as JSON text.
 */
export const page = query({
  args: {
    startDate: v.string(),
    endDate: v.string(),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const start = requirePresentIsoDate('start_date', args.startDate);
    const end = requirePresentIsoDate('end_date', args.endDate);
    if (end < start) throw apiError(400, 'end_date must not be before start_date');
    const numItems = args.numItems ?? RESULTS_PAGE_SIZE;
    if (!Number.isInteger(numItems) || numItems < 1 || numItems > MAX_RESULTS_PAGE_SIZE) {
      throw apiError(400, `numItems must be a whole number from 1 to ${MAX_RESULTS_PAGE_SIZE}`);
    }
    const result = await ctx.db
      .query('lifting_results')
      .withIndex('by_date', (q) => q.gte('date', start).lte('date', end))
      .paginate({ cursor: args.cursor, numItems });
    return {
      json: JSON.stringify(result.page.map(toApiLiftingResult)),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** `GET /lifting-results`: a meet's results, by name. Answers `{ json }`. */
export const byMeet = query({
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

/** Bests over a newest-first mark list cut at `cutoff` (inclusive); the same numbers `bestsOf(since(...))` gives. */
function bestsOfMarks(marks: readonly Mark[], cutoff: string): YearBests | null {
  let bests = null as YearBests | null;
  for (const [date, snatch, cj, total] of marks) {
    if (date < cutoff) break;
    bests = {
      best_snatch: Math.max(bests?.best_snatch ?? 0, snatch),
      best_cj: Math.max(bests?.best_cj ?? 0, cj),
      best_total: Math.max(bests?.best_total ?? 0, total),
    };
  }
  return bests;
}

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
    const bests = bestsOfMarks(marks, cutoff);
    if (bests) bestByKey.set(key, bests);
  }
  return Array.from(new Set(names))
    .sort(compareBytes)
    .map((name) => ({ name, ...(bestByKey.get(normalizeName(name)) ?? ZERO_BESTS) }));
}

export function answerYearBests(marks: readonly Mark[], cutoff: string): YearBests {
  return bestsOfMarks(marks, cutoff) ?? ZERO_BESTS;
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
export const byNames = query({
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
export const recent = query({
  args: { names: v.array(v.string()), cutoffDate: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const names = cleanNameList(args.names);
    requireNameList(names);
    const cutoff = requirePresentIsoDate('cutoff_date', args.cutoffDate);
    return { json: answerRecent(await readHistories(ctx, distinctNameKeys(names)), cutoff) };
  },
});

/** `GET /lifting-results/year`: one athlete's bests since `cutoffDate`. */
export const yearBests = query({
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
export const bests = query({
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

const MAX_SEARCH_RESULT_ROWS = 600;
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

/** Rows dated in `[start, end)`, oldest first. */
function inRange(history: readonly ApiLiftingResult[], start: string, end: string): ApiLiftingResult[] {
  return history.filter((row) => row.date >= start && row.date < end).reverse();
}

/**
 * `GET /search`: without dates, name suggestions (`ILIKE '%query%'`). With
 * dates, the exact (case- and whitespace-folded) name's results in the range,
 * or, failing that, every matching name's results plus suggestions.
 */
export const search = query({
  args: {
    query: v.string(),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireNonEmpty('query', args.query);
    requireIsoDate('start_date', args.startDate);
    requireIsoDate('end_date', args.endDate);
    const matchingNames = async (limit: number) => searchDirectory(await searchText(ctx, args.query), args.query, limit);

    if (args.startDate === undefined || args.endDate === undefined) {
      return { matched_name: null, suggestions: await matchingNames(MAX_SEARCH_SUGGESTIONS), results: [] };
    }
    const start = args.startDate;
    const end = args.endDate;

    const exactKey = normalizeName(args.query);
    const exact = inRange((await readHistories(ctx, [exactKey])).get(exactKey) ?? [], start, end);
    if (exact.length > 0) {
      return { matched_name: args.query, suggestions: [], results: exact.slice(0, MAX_SEARCH_RESULT_ROWS) };
    }

    const matched = await matchingNames(MAX_FALLBACK_NAMES);
    const histories = await readHistories(ctx, distinctNameKeys(matched));
    const matches = nameMatcher(args.query);
    const rows: ApiLiftingResult[] = [];
    for (const history of histories.values()) {
      for (const row of inRange(history, start, end)) {
        if (matches(row.name)) rows.push(row);
      }
    }
    rows.sort((a, b) => compareBytes(a.date, b.date));
    return {
      matched_name: null,
      suggestions: matched.slice(0, MAX_SEARCH_SUGGESTIONS),
      results: rows.slice(0, MAX_SEARCH_RESULT_ROWS),
    };
  },
});
