import { v } from 'convex/values';
import { query, type QueryCtx } from './_generated/server';
import { nameMatcher, searchDirectory } from './lib/directory';
import { readHistories } from './lib/history';
import { cleanNameList, distinctNameKeys, normalizeName, requestedNamesByKey } from './lib/names';
import { ZERO_BESTS, type ApiLiftingResult, type NamedBests, type YearBests } from './lib/results';
import { compareBytes } from './lib/sort';
import { RESULT_NAMES_VIEW } from './lib/viewKeys';
import { readViewTextAnyAge } from './lib/views';
import { apiError, requireIsoDate, requireNameList, requireNonEmpty, requirePresentIsoDate } from './lib/validation';

// `/lifting-results/*` and `/search`: each query answers the JSON of the Rust
// route of the same name. Per-athlete reads go through the athlete history
// documents (`lib/history.ts`): one document per name instead of one per
// result. Row lists travel as JSON text (`{ json }`).

export const MAX_LIMIT_PER_NAME = 200;

/** Newest first across athletes (a stable sort keeps each athlete's own order). */
function newestFirst(rows: ApiLiftingResult[]): ApiLiftingResult[] {
  return rows.sort((a, b) => compareBytes(b.date, a.date));
}

/** `best_lifts_columns!` over API rows (their nulls already read as 0). */
function bestsOf(rows: readonly ApiLiftingResult[]): YearBests {
  let bests = ZERO_BESTS;
  for (const row of rows) {
    bests = {
      best_snatch: Math.max(bests.best_snatch, row.snatch_best, row.snatch1, row.snatch2, row.snatch3),
      best_cj: Math.max(bests.best_cj, row.cj_best, row.cj1, row.cj2, row.cj3),
      best_total: Math.max(bests.best_total, row.total),
    };
  }
  return bests;
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

export function answerBests(histories: Histories, names: readonly string[], cutoff: string): NamedBests[] {
  const bestByKey = new Map<string, YearBests>();
  for (const [key, history] of histories) {
    const window = since(history, cutoff);
    if (window.length > 0) bestByKey.set(key, bestsOf(window));
  }
  return Array.from(new Set(names))
    .sort(compareBytes)
    .map((name) => ({ name, ...(bestByKey.get(normalizeName(name)) ?? ZERO_BESTS) }));
}

export function answerYearBests(history: readonly ApiLiftingResult[], cutoff: string): YearBests {
  return bestsOf(since(history, cutoff));
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
    const histories = await readHistories(ctx, distinctNameKeys(names));
    return { json: answerByNames(histories, args.latestOnly ?? false, args.limitPerName) };
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
    return answerYearBests((await readHistories(ctx, [key])).get(key) ?? [], cutoff);
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
    const histories = await readHistories(ctx, [...requestedNamesByKey(names).keys()]);
    return answerBests(histories, names, cutoff);
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
    const matchingNames = async (limit: number) => searchDirectory(await directory(ctx), args.query, limit);

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
