import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { compareNewestFirst, toApiLiftingResult, type ApiLiftingResult } from './results';

/**
 * One document per athlete (folded name) holding their whole result history
 * as JSON text, newest first, in the API's row shape.
 *
 * The name-list reads (`results:*`) ask about up to 100 athletes at once;
 * reading their history rows one by one is thousands of documents, reading
 * these is one per athlete. Unlike the views, histories are never stale:
 * every write to `lifting_results` rewrites the touched athletes' documents in
 * the same transaction (`convex/ingest.ts`).
 *
 * Until the first full build has finished (`HISTORY_READY`), readers compute
 * from `lifting_results` instead, since a missing document would otherwise
 * read as "no results".
 */
export const HISTORY_READY = 'athlete_history_ready';

export async function historiesReady(ctx: QueryCtx): Promise<boolean> {
  const row = await ctx.db
    .query('data_versions')
    .withIndex('by_table', (q) => q.eq('table', HISTORY_READY))
    .unique();
  return (row?.version ?? 0) > 0;
}

async function historyRows(ctx: QueryCtx, key: string): Promise<Doc<'lifting_results'>[]> {
  return await ctx.db
    .query('lifting_results')
    .withIndex('by_nameKey_and_date', (q) => q.eq('nameKey', key))
    .collect();
}

/** The athlete's history from `lifting_results`, newest first. */
export async function computeHistory(ctx: QueryCtx, key: string): Promise<ApiLiftingResult[]> {
  return (await historyRows(ctx, key)).sort(compareNewestFirst).map(toApiLiftingResult);
}

/**
 * One result's bests, `[date, snatch, clean & jerk, total]`: the same maxima
 * `results:bests` takes over full rows (a row's best and its attempts).
 */
export type Mark = [date: string, snatch: number, cj: number, total: number];

export type Summary = { latest: ApiLiftingResult[]; marks: Mark[] };

/** What the summary document holds for a newest-first history. */
export function summaryOf(rows: readonly ApiLiftingResult[]): { latest: string; marks: string } {
  const latestDate = rows[0]?.date;
  return {
    latest: JSON.stringify(rows.filter((row) => row.date === latestDate)),
    marks: JSON.stringify(
      rows.map((row): Mark => [
        row.date,
        Math.max(row.snatch_best, row.snatch1, row.snatch2, row.snatch3),
        Math.max(row.cj_best, row.cj1, row.cj2, row.cj3),
        row.total,
      ]),
    ),
  };
}

/**
 * Rewrites the history and summary documents of `keys` from
 * `lifting_results`; returns how many histories changed. A summary missing
 * beside an unchanged history (written before summaries existed) is filled in.
 */
export async function writeHistories(ctx: MutationCtx, keys: Iterable<string>): Promise<number> {
  const changed = await inBatches(
    [...new Set(keys)],
    async (key) => {
      const [rows, existing, summary] = await Promise.all([
        computeHistory(ctx, key),
        ctx.db
          .query('athlete_history')
          .withIndex('by_nameKey', (q) => q.eq('nameKey', key))
          .unique(),
        ctx.db
          .query('athlete_summary')
          .withIndex('by_nameKey', (q) => q.eq('nameKey', key))
          .unique(),
      ]);
      if (rows.length === 0) {
        if (summary) await ctx.db.delete(summary._id);
        if (!existing) return false;
        await ctx.db.delete(existing._id);
        return true;
      }
      const next = summaryOf(rows);
      if (!summary) await ctx.db.insert('athlete_summary', { nameKey: key, ...next });
      else if (summary.latest !== next.latest || summary.marks !== next.marks) await ctx.db.patch(summary._id, next);
      const json = JSON.stringify(rows);
      if (existing?.json === json) return false;
      if (existing) await ctx.db.patch(existing._id, { json });
      else await ctx.db.insert('athlete_history', { nameKey: key, json });
      return true;
    },
  );
  return changed.filter(Boolean).length;
}

/**
 * Reads in flight at once when a caller asks about many athletes (the search
 * fallback asks about up to 1,000): at the per-function limit on concurrent
 * reads, not over it.
 */
const READ_BATCH = 250;

async function inBatches<T>(keys: readonly string[], read: (key: string) => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < keys.length; i += READ_BATCH) out.push(...(await Promise.all(keys.slice(i, i + READ_BATCH).map(read))));
  return out;
}

/**
 * Each athlete's summary: the summary document when there is one, otherwise
 * derived from the history (live before the first build, or from the history
 * document where the summary has not been written yet).
 */
export async function readSummaries(ctx: QueryCtx, keys: readonly string[]): Promise<Map<string, Summary>> {
  const ready = await historiesReady(ctx);
  const parse = (latest: string, marks: string): Summary => ({ latest: JSON.parse(latest) as ApiLiftingResult[], marks: JSON.parse(marks) as Mark[] });
  const entries = await inBatches(
    keys,
    async (key): Promise<[string, Summary]> => {
      if (ready) {
        const doc = await ctx.db
          .query('athlete_summary')
          .withIndex('by_nameKey', (q) => q.eq('nameKey', key))
          .unique();
        if (doc) return [key, parse(doc.latest, doc.marks)];
      }
      const history = (await readHistories(ctx, [key])).get(key) ?? [];
      const derived = summaryOf(history);
      return [key, parse(derived.latest, derived.marks)];
    },
  );
  return new Map(entries);
}

/**
 * Each key's history, newest first. From the history documents once they are
 * built, from `lifting_results` before.
 */
export async function readHistories(ctx: QueryCtx, keys: readonly string[]): Promise<Map<string, ApiLiftingResult[]>> {
  const ready = await historiesReady(ctx);
  const entries = await inBatches(
    keys,
    async (key): Promise<[string, ApiLiftingResult[]]> => {
      if (!ready) return [key, await computeHistory(ctx, key)];
      const doc = await ctx.db
        .query('athlete_history')
        .withIndex('by_nameKey', (q) => q.eq('nameKey', key))
        .unique();
      return [key, doc ? (JSON.parse(doc.json) as ApiLiftingResult[]) : []];
    },
  );
  return new Map(entries);
}
