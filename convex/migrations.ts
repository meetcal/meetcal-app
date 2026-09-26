import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import { internal } from './_generated/api';
import { normalizeName } from './lib/names';
import { deleteViewsWithPrefix } from './lib/views';

const BACKFILL_PAGE_SIZE = 500;

/**
 * Fills `lifting_results.nameKey` on rows written before it existed, a page
 * per mutation, each page scheduling the next so no single transaction comes
 * near the write limits. Idempotent: rows that already hold the right key are
 * skipped, so it can be re-run after any bulk load.
 *
 *   npx convex run migrations:backfillNameKeys
 */
export const backfillNameKeys = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), patched: v.optional(v.number()) },
  handler: async (ctx, { cursor, patched = 0 }) => {
    const page = await ctx.db
      .query('lifting_results')
      .paginate({ cursor: cursor ?? null, numItems: BACKFILL_PAGE_SIZE });
    let count = patched;
    for (const row of page.page) {
      const nameKey = normalizeName(row.name);
      if (row.nameKey !== nameKey) {
        await ctx.db.patch(row._id, { nameKey });
        count += 1;
      }
    }
    if (page.isDone) {
      console.log(`backfillNameKeys: done, ${count} rows patched`);
      await ctx.scheduler.runAfter(0, internal.views.rebuildAll, {});
      return;
    }
    await ctx.scheduler.runAfter(0, internal.migrations.backfillNameKeys, {
      cursor: page.continueCursor,
      patched: count,
    });
  },
});

/** Drops views an earlier layout built and nothing reads any more. */
export const dropRetiredViews = internalMutation({
  args: {},
  handler: async (ctx) => {
    let dropped = 0;
    for (const header of await ctx.db.query('views').collect()) {
      const retired =
        header.key === 'result-names' ||
        (header.key.startsWith('meet|') && (header.key.endsWith('|package_athletes') || header.key.endsWith('|results') || header.key.endsWith('|roster')));
      if (!retired) continue;
      dropped += await deleteViewsWithPrefix(ctx, header.key);
    }
    return dropped;
  },
});
