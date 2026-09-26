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

/** Rewrites the history documents of `keys` from `lifting_results`; returns how many changed. */
export async function writeHistories(ctx: MutationCtx, keys: Iterable<string>): Promise<number> {
  const changed = await Promise.all(
    [...new Set(keys)].map(async (key) => {
      const [rows, existing] = await Promise.all([
        computeHistory(ctx, key),
        ctx.db
          .query('athlete_history')
          .withIndex('by_nameKey', (q) => q.eq('nameKey', key))
          .unique(),
      ]);
      if (rows.length === 0) {
        if (!existing) return false;
        await ctx.db.delete(existing._id);
        return true;
      }
      const json = JSON.stringify(rows);
      if (existing?.json === json) return false;
      if (existing) await ctx.db.patch(existing._id, { json });
      else await ctx.db.insert('athlete_history', { nameKey: key, json });
      return true;
    }),
  );
  return changed.filter(Boolean).length;
}

/**
 * Each key's history, newest first. From the history documents once they are
 * built, from `lifting_results` before.
 */
export async function readHistories(ctx: QueryCtx, keys: readonly string[]): Promise<Map<string, ApiLiftingResult[]>> {
  const ready = await historiesReady(ctx);
  const entries = await Promise.all(
    keys.map(async (key): Promise<[string, ApiLiftingResult[]]> => {
      if (!ready) return [key, await computeHistory(ctx, key)];
      const doc = await ctx.db
        .query('athlete_history')
        .withIndex('by_nameKey', (q) => q.eq('nameKey', key))
        .unique();
      return [key, doc ? (JSON.parse(doc.json) as ApiLiftingResult[]) : []];
    }),
  );
  return new Map(entries);
}
