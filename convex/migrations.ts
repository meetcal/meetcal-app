import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { normalizeName } from './lib/names';
import { deleteViewsWithPrefix } from './lib/views';
import { normalizeAgeCategory, normalizeGender } from './lib/normalize';
import { recordWrite } from './ingest';

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

/**
 * The Postgres casing migration (`20260604130000_normalize_gender_age_casing`)
 * for the Convex copies of the reference tables, using the writer's own
 * normalizers. When normalizing makes a row collide with another on the
 * table's natural key, the most recently written one is kept, since that is
 * the one a scraper wrote with normalized values.
 *
 *   npx convex run migrations:normalizeReferenceCasing '{"table":"standards"}'
 */
export const normalizeReferenceCasing = internalMutation({
  args: {
    table: v.union(
      v.literal('standards'),
      v.literal('records'),
      v.literal('wso_records'),
      v.literal('qualifying_totals'),
      v.literal('intl_rankings'),
    ),
  },
  handler: async (ctx, { table }) => {
    const rows = (await ctx.db.query(table).collect()).sort((a, b) => b._creationTime - a._creationTime);
    const naturalKey = (row: Record<string, unknown>): string | null => {
      switch (table) {
        case 'standards':
          return JSON.stringify([row.ageCategory, row.gender, row.weightClass]);
        case 'records':
          return JSON.stringify([row.recordType, row.ageCategory, row.gender, row.weightClass]);
        case 'wso_records':
          return JSON.stringify([row.wso, row.ageCategory, row.gender, row.weightClass]);
        case 'qualifying_totals':
          return JSON.stringify([row.eventName, row.gender, row.ageCategory, row.weightClass]);
        default:
          return null;
      }
    };
    const seen = new Set<string>();
    let patched = 0;
    let deleted = 0;
    for (const row of rows) {
      const normalized: Record<string, string> = {};
      if (typeof row.gender === 'string') normalized.gender = normalizeGender(row.gender);
      if (typeof row.ageCategory === 'string') normalized.ageCategory = normalizeAgeCategory(row.ageCategory);
      const key = naturalKey({ ...row, ...normalized });
      if (key !== null && seen.has(key)) {
        await ctx.db.delete(row._id);
        deleted += 1;
        continue;
      }
      if (key !== null) seen.add(key);
      if (normalized.gender !== row.gender || normalized.ageCategory !== row.ageCategory) {
        await ctx.db.patch(row._id, normalized as never);
        patched += 1;
      }
    }
    if (patched + deleted > 0) await recordWrite(ctx, table, [{ kind: 'table', key: table }]);
    return { rows: rows.length, patched, deleted };
  },
});

const COUNTED_TABLES = v.union(
  v.literal('athletes'),
  v.literal('lifting_results'),
  v.literal('meets'),
  v.literal('wso_records'),
  v.literal('records'),
  v.literal('standards'),
  v.literal('qualifying_totals'),
  v.literal('intl_rankings'),
  v.literal('session_schedule'),
  v.literal('saved_sessions'),
  v.literal('user_preferences'),
);

/**
 * One page of a table's row count, for checking a data load against its
 * source (the CLI cannot page the large tables):
 *
 *   npx convex run migrations:countPage '{"table": "lifting_results"}'   # repeat with the returned cursor
 */
export const countPage = internalQuery({
  args: { table: COUNTED_TABLES, cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { table, cursor }) => {
    const page = await ctx.db.query(table).paginate({ cursor: cursor ?? null, numItems: 8000 });
    return { count: page.page.length, cursor: page.continueCursor, isDone: page.isDone };
  },
});
