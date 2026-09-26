import { v } from 'convex/values';
import { internalMutation, type MutationCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { writeHistories } from './lib/history';
import { normalizeAgeCategory, normalizeGender } from './lib/normalize';
import { meetLocalDate, type ZoneFormatters } from './lib/meetData';
import { normalizeName } from './lib/names';
import { bumpVersion, type SourceTable } from './lib/views';
import {
  athletesFields,
  intlRankingsFields,
  liftingResultsFields,
  meetsFields,
  qualifyingTotalsFields,
  recordsFields,
  sessionScheduleFields,
  standardsFields,
  wsoRecordsFields,
} from './schema';
import { scheduleRefresh } from './views';

/**
 * The write path for competition data. Scrapers and syncs call these internal
 * mutations (with a deploy key); nothing else may write the source tables,
 * because every write here does three things the materialized views rely on
 * (`convex/lib/views.ts`):
 *
 * 1. bumps the table's version, so every view built from it stops being
 *    served until rebuilt (result writes also rewrite the touched athletes'
 *    history documents, in the same transaction);
 * 2. leaves hints naming what changed (old and new values of each row), so
 *    the refresh rebuilds only the views those rows feed;
 * 3. schedules that refresh.
 */

type WriteHint = { kind: string; key: string };

export async function recordWrite(ctx: MutationCtx, table: SourceTable, hints: WriteHint[]): Promise<void> {
  await bumpVersion(ctx, table);
  const unique = new Map(hints.map((h) => [`${h.kind}\u0000${h.key}`, h]));
  for (const hint of unique.values()) {
    const existing = await ctx.db
      .query('view_hints')
      .withIndex('by_kind_key', (q) => q.eq('kind', hint.kind).eq('key', hint.key))
      .first();
    if (!existing) await ctx.db.insert('view_hints', hint);
  }
  await scheduleRefresh(ctx);
}

type ResultFields = Pick<Doc<'lifting_results'>, 'federation' | 'age' | 'meet' | 'name' | 'adaptive'>;

/** Everything a result row feeds: its ranking class, meet, athlete, name. */
function resultHints(row: ResultFields): WriteHint[] {
  const hints: WriteHint[] = [
    { kind: 'meet', key: row.meet },
    { kind: 'athlete', key: normalizeName(row.name) },
    { kind: 'name', key: row.name },
  ];
  if (row.federation !== undefined && row.age !== undefined) {
    hints.push({ kind: 'nat', key: JSON.stringify([row.federation, row.age]) });
  }
  if (row.adaptive) hints.push({ kind: 'adaptive', key: '1' });
  return hints;
}

/** The athletes a batch of result hints touched; their histories are rewritten in the same transaction. */
function athleteKeys(hints: WriteHint[]): string[] {
  return hints.filter((h) => h.kind === 'athlete').map((h) => h.key);
}

const liftingResult = v.object(liftingResultsFields);

/**
 * Inserts or updates results, matched on `(eventId, name)` like the scrapers
 * always have. `nameKey` is derived here, never taken from the caller.
 */
export const upsertLiftingResults = internalMutation({
  args: { rows: v.array(liftingResult) },
  handler: async (ctx, { rows }) => {
    const hints: WriteHint[] = [];
    let inserted = 0;
    let updated = 0;
    for (const row of rows) {
      const doc = { ...row, nameKey: normalizeName(row.name) };
      const existing = await ctx.db
        .query('lifting_results')
        .withIndex('by_event_and_name', (q) => q.eq('eventId', row.eventId).eq('name', row.name))
        .first();
      if (existing) {
        hints.push(...resultHints(existing));
        await ctx.db.replace(existing._id, doc);
        updated += 1;
      } else {
        await ctx.db.insert('lifting_results', doc);
        inserted += 1;
      }
      hints.push(...resultHints(doc));
    }
    if (rows.length > 0) {
      await writeHistories(ctx, athleteKeys(hints));
      await recordWrite(ctx, 'lifting_results', hints);
    }
    return { inserted, updated };
  },
});

export const deleteLiftingResults = internalMutation({
  args: { keys: v.array(v.object({ eventId: v.string(), name: v.string() })) },
  handler: async (ctx, { keys }) => {
    const hints: WriteHint[] = [];
    let deleted = 0;
    for (const { eventId, name } of keys) {
      const rows = await ctx.db
        .query('lifting_results')
        .withIndex('by_event_and_name', (q) => q.eq('eventId', eventId).eq('name', name))
        .collect();
      for (const row of rows) {
        hints.push(...resultHints(row));
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }
    if (deleted > 0) {
      await writeHistories(ctx, athleteKeys(hints));
      await recordWrite(ctx, 'lifting_results', hints);
    }
    return { deleted };
  },
});

/** Replaces a meet's start list. */
export const replaceMeetAthletes = internalMutation({
  args: { meet: v.string(), rows: v.array(v.object(athletesFields)) },
  handler: async (ctx, { meet, rows }) => {
    if (rows.some((row) => row.meet !== meet)) throw new Error('every row must belong to `meet`');
    const existing = await ctx.db
      .query('athletes')
      .withIndex('by_meet', (q) => q.eq('meet', meet))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);
    for (const row of rows) await ctx.db.insert('athletes', row);
    await recordWrite(ctx, 'athletes', [
      { kind: 'meet', key: meet },
      { kind: 'table', key: 'athletes' },
    ]);
    return { deleted: existing.length, inserted: rows.length };
  },
});

/** Replaces a meet's session schedule. */
export const replaceMeetSchedule = internalMutation({
  args: { meet: v.string(), rows: v.array(v.object(sessionScheduleFields)) },
  handler: async (ctx, { meet, rows }) => {
    if (rows.some((row) => row.meet !== meet)) throw new Error('every row must belong to `meet`');
    const existing = await ctx.db
      .query('session_schedule')
      .withIndex('by_meet', (q) => q.eq('meet', meet))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);
    for (const row of rows) await ctx.db.insert('session_schedule', row);
    await recordWrite(ctx, 'session_schedule', [{ kind: 'meet', key: meet }]);
    return { deleted: existing.length, inserted: rows.length };
  },
});

/** Inserts or updates a meet, matched on name. */
export const upsertMeet = internalMutation({
  args: { row: v.object(meetsFields) },
  handler: async (ctx, { row }) => {
    const existing = await ctx.db
      .query('meets')
      .withIndex('by_name', (q) => q.eq('name', row.name))
      .first();
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert('meets', row);
    // The package views embed the meet row.
    await recordWrite(ctx, 'meets', [{ kind: 'meet', key: row.name }]);
    return { updated: existing !== null };
  },
});

const referenceTables = {
  records: recordsFields,
  standards: standardsFields,
  qualifying_totals: qualifyingTotalsFields,
  intl_rankings: intlRankingsFields,
  wso_records: wsoRecordsFields,
} as const;

function replaceTable<T extends keyof typeof referenceTables>(table: T) {
  return internalMutation({
    args: { rows: v.array(v.object(referenceTables[table])) },
    handler: async (ctx, { rows }) => {
      const existing = await ctx.db.query(table).collect();
      for (const row of existing) await ctx.db.delete(row._id);
      for (const row of rows) await ctx.db.insert(table, row as never);
      await recordWrite(ctx, table, [{ kind: 'table', key: table }]);
      return { deleted: existing.length, inserted: rows.length };
    },
  });
}

/** Wholesale replacement of the small reference tables. */
export const replaceRecords = replaceTable('records');
export const replaceStandards = replaceTable('standards');
export const replaceQualifyingTotals = replaceTable('qualifying_totals');
export const replaceIntlRankings = replaceTable('intl_rankings');
export const replaceWsoRecords = replaceTable('wso_records');

/**
 * Marks meets completed once their end date has passed on the meet's own
 * calendar (`complete_ended_meets.sql` in the Rust backend): a meet ending
 * tonight in Los Angeles is not completed at 17:00 Pacific just because the
 * UTC date rolled over. Run hourly by `convex/crons.ts`; writes only when a
 * meet actually changes, through `recordWrite` like every other write.
 */
export const completeEndedMeets = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const formatters: ZoneFormatters = new Map();
    const hints: WriteHint[] = [];
    for (const status of ['upcoming', 'ongoing'] as const) {
      const meets = await ctx.db
        .query('meets')
        .withIndex('by_status', (q) => q.eq('status', status))
        .collect();
      for (const meet of meets) {
        if (meet.endDate >= meetLocalDate(now, meet.timeZone, formatters)) continue;
        await ctx.db.patch(meet._id, { status: 'completed', updatedAt: now });
        hints.push({ kind: 'meet', key: meet.name });
      }
    }
    if (hints.length > 0) await recordWrite(ctx, 'meets', hints);
    console.log(`Marked ${hints.length} ended meet(s) completed.`);
    return hints.length;
  },
});

/** Per-row outcome of an upsert, as the Python writers reported it. */
export type UpsertOutcome = { wasInsert: boolean; wasChanged: boolean };

/**
 * Inserts or updates standards matched on (age category, gender, weight
 * class), normalized like `upsert_standard`. Never deletes: a class the PDF
 * stops listing keeps its last standards, as it did in Postgres.
 */
export const upsertStandards = internalMutation({
  args: {
    rows: v.array(
      v.object({ ageCategory: v.string(), gender: v.string(), weightClass: v.string(), standardA: v.number(), standardB: v.number() }),
    ),
  },
  handler: async (ctx, { rows }): Promise<UpsertOutcome[]> => {
    const outcomes: UpsertOutcome[] = [];
    for (const row of rows) {
      const doc = {
        ageCategory: normalizeAgeCategory(row.ageCategory),
        gender: normalizeGender(row.gender),
        weightClass: row.weightClass,
        standardA: row.standardA,
        standardB: row.standardB,
      };
      const existing = (
        await ctx.db
          .query('standards')
          .withIndex('by_age_gender', (q) => q.eq('ageCategory', doc.ageCategory).eq('gender', doc.gender))
          .collect()
      ).find((s) => s.weightClass === doc.weightClass);
      if (!existing) {
        await ctx.db.insert('standards', doc);
        outcomes.push({ wasInsert: true, wasChanged: true });
      } else if (existing.standardA !== doc.standardA || existing.standardB !== doc.standardB) {
        await ctx.db.patch(existing._id, doc);
        outcomes.push({ wasInsert: false, wasChanged: true });
      } else {
        outcomes.push({ wasInsert: false, wasChanged: false });
      }
    }
    if (outcomes.some((o) => o.wasChanged)) await recordWrite(ctx, 'standards', [{ kind: 'table', key: 'standards' }]);
    return outcomes;
  },
});
