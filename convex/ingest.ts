import { v } from 'convex/values';
import { internalMutation, type MutationCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { writeHistories } from './lib/history';
import { normalizeAgeCategory, normalizeFederation, normalizeGender } from './lib/normalize';
import { meetLocalDate, type ZoneFormatters } from './lib/meetData';
import { normalizeName } from './lib/names';
import { bumpVersion, type SourceTable } from './lib/views';
import {
  athletesFields,
  intlRankingsFields,
  liftingResultsFields,
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
 * Inserts or updates results, matched on (eventId, meet, name) like the
 * Python writer's natural key. `nameKey` is derived here, never taken from
 * the caller, and the federation is normalized (`normalize_federation`). A
 * row whose values are unchanged is not written, so re-syncing an unchanged
 * meet bumps no version and invalidates no view.
 */
export const upsertLiftingResults = internalMutation({
  args: { rows: v.array(liftingResult) },
  handler: async (ctx, { rows }) => {
    const hints: WriteHint[] = [];
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    for (const row of rows) {
      const { legacyId: _legacy, nameKey: _key, ...fields } = row;
      const doc = {
        ...fields,
        federation: fields.federation === undefined ? undefined : normalizeFederation(fields.federation),
        nameKey: normalizeName(row.name),
      };
      const existing = (
        await ctx.db
          .query('lifting_results')
          .withIndex('by_event_and_name', (q) => q.eq('eventId', row.eventId).eq('name', row.name))
          .collect()
      ).find((r) => r.meet === row.meet);
      if (!existing) {
        await ctx.db.insert('lifting_results', doc);
        inserted += 1;
        hints.push(...resultHints(doc));
        continue;
      }
      const { _id, _creationTime, ...current } = existing;
      if (sameValues(current, doc)) {
        unchanged += 1;
        continue;
      }
      hints.push(...resultHints(existing));
      await ctx.db.replace(_id, doc);
      updated += 1;
      hints.push(...resultHints(doc));
    }
    if (hints.length > 0) {
      await writeHistories(ctx, athleteKeys(hints));
      await recordWrite(ctx, 'lifting_results', hints);
    }
    return { inserted, updated, unchanged };
  },
});

/** Field-by-field equality of two documents' values (absent and `undefined` are the same). */
function sameValues(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] === undefined && b[key] === undefined) continue;
    if (a[key] !== b[key]) return false;
  }
  return true;
}

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

const scrapedMeet = v.object({
  name: v.string(),
  venueName: v.string(),
  venueStreet: v.string(),
  venueCity: v.string(),
  venueState: v.string(),
  venueZip: v.string(),
  timeZone: v.string(),
  startDate: v.string(),
  endDate: v.string(),
  status: v.union(v.literal('upcoming'), v.literal('ongoing'), v.literal('completed')),
  federation: v.optional(v.string()),
});

/**
 * Inserts or updates meets matched on name (`upsert_meet`). Only the scraped
 * columns are written: a meet already marked completed stays completed, and
 * fields the scrapers do not own (venue map links) are kept. A meet whose
 * scraped values are unchanged is not written; `updatedAt` moves only with a
 * real change, so the nightly syncs do not invalidate every meet's views.
 */
export const upsertMeets = internalMutation({
  args: { rows: v.array(scrapedMeet) },
  handler: async (ctx, { rows }): Promise<UpsertOutcome[]> => {
    const outcomes: UpsertOutcome[] = [];
    const hints: WriteHint[] = [];
    const now = Date.now();
    for (const row of rows) {
      const values = { ...row, federation: normalizeFederation(row.federation ?? 'USAW') };
      const existing = await ctx.db
        .query('meets')
        .withIndex('by_name', (q) => q.eq('name', row.name))
        .first();
      if (!existing) {
        await ctx.db.insert('meets', { ...values, updatedAt: now });
        outcomes.push({ wasInsert: true, wasChanged: true });
        hints.push({ kind: 'meet', key: row.name });
        continue;
      }
      if (existing.status === 'completed') values.status = 'completed';
      const changed = (Object.keys(values) as (keyof typeof values)[]).some((key) => existing[key] !== values[key]);
      if (changed) {
        await ctx.db.patch(existing._id, { ...values, updatedAt: now });
        hints.push({ kind: 'meet', key: row.name });
      }
      outcomes.push({ wasInsert: false, wasChanged: changed });
    }
    if (hints.length) await recordWrite(ctx, 'meets', hints);
    return outcomes;
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

const recordRow = v.object({
  recordType: v.string(),
  ageCategory: v.string(),
  gender: v.string(),
  weightClass: v.string(),
  snatchRecord: v.optional(v.number()),
  cjRecord: v.optional(v.number()),
  totalRecord: v.optional(v.number()),
});

/**
 * Inserts or updates records matched on (type, age, gender, class),
 * normalized like `upsert_record`. A lift missing from the row clears it, as
 * the Python writer's `None` did. Never deletes.
 */
export const upsertRecords = internalMutation({
  args: { rows: v.array(recordRow) },
  handler: async (ctx, { rows }): Promise<UpsertOutcome[]> => {
    const outcomes: UpsertOutcome[] = [];
    for (const row of rows) {
      const doc = {
        recordType: row.recordType,
        ageCategory: normalizeAgeCategory(row.ageCategory),
        gender: normalizeGender(row.gender),
        weightClass: row.weightClass,
        snatchRecord: row.snatchRecord,
        cjRecord: row.cjRecord,
        totalRecord: row.totalRecord,
      };
      const existing = (
        await ctx.db
          .query('records')
          .withIndex('by_type_age_gender', (q) =>
            q.eq('recordType', doc.recordType).eq('ageCategory', doc.ageCategory).eq('gender', doc.gender),
          )
          .collect()
      ).find((r) => r.weightClass === doc.weightClass);
      if (!existing) {
        await ctx.db.insert('records', doc);
        outcomes.push({ wasInsert: true, wasChanged: true });
      } else if (
        existing.snatchRecord !== doc.snatchRecord ||
        existing.cjRecord !== doc.cjRecord ||
        existing.totalRecord !== doc.totalRecord
      ) {
        await ctx.db.replace(existing._id, doc);
        outcomes.push({ wasInsert: false, wasChanged: true });
      } else {
        outcomes.push({ wasInsert: false, wasChanged: false });
      }
    }
    if (outcomes.some((o) => o.wasChanged)) await recordWrite(ctx, 'records', [{ kind: 'table', key: 'records' }]);
    return outcomes;
  },
});

const intlRankingRow = v.object({
  ranking: v.number(),
  name: v.string(),
  weightClass: v.optional(v.string()),
  total: v.optional(v.number()),
  percentA: v.optional(v.number()),
});

type SyncCounts = { inserted: number; updated: number; unchanged: number; deleted: number };

/**
 * Exact-set sync of one international rankings group (meet, gender, age),
 * `replace_intl_rankings_group` in the Python writer: rows are keyed by
 * (rank, name); a row missing from the payload is deleted, an unchanged one
 * left alone. The whole payload is checked before anything is written, so a
 * duplicate key aborts with no change, and an empty payload (a failed scrape,
 * not an empty group) is refused.
 */
export const replaceIntlRankingsGroup = internalMutation({
  args: { meet: v.string(), gender: v.string(), ageCategory: v.string(), rankings: v.array(intlRankingRow) },
  handler: async (ctx, args): Promise<SyncCounts> => {
    const meet = args.meet;
    const gender = normalizeGender(args.gender);
    const ageCategory = normalizeAgeCategory(args.ageCategory);
    for (const [field, value] of [['meet', meet], ['gender', gender], ['ageCategory', ageCategory]] as const) {
      if (!value.trim()) throw new Error(`${field} is required`);
    }
    if (args.rankings.length === 0) {
      throw new Error(`refusing to replace intl rankings for ${meet}/${gender}/${ageCategory} with an empty payload`);
    }
    const existing = (
      await ctx.db
        .query('intl_rankings')
        .withIndex('by_gender_age', (q) => q.eq('gender', gender).eq('ageCategory', ageCategory))
        .collect()
    ).filter((row) => row.meet === meet);
    const keyOf = (ranking: number | undefined, name: string | undefined) => JSON.stringify([ranking, name]);
    const existingByKey = new Map(existing.map((row) => [keyOf(row.ranking, row.name), row]));

    const incoming = new Set<string>();
    const writes: { id: (typeof existing)[number]['_id'] | null; doc: Omit<(typeof existing)[number], '_id' | '_creationTime'> }[] = [];
    const counts: SyncCounts = { inserted: 0, updated: 0, unchanged: 0, deleted: 0 };
    for (const row of args.rankings) {
      const key = keyOf(row.ranking, row.name);
      if (incoming.has(key)) throw new Error(`Duplicate intl ranking in payload: ${meet}/${gender}/${ageCategory}/${row.ranking}/${row.name}`);
      incoming.add(key);
      const doc = { meet, ranking: row.ranking, name: row.name, weightClass: row.weightClass, total: row.total, percentA: row.percentA, gender, ageCategory };
      const current = existingByKey.get(key);
      if (!current) {
        counts.inserted += 1;
        writes.push({ id: null, doc });
      } else if (
        current.legacyId !== undefined ||
        current.weightClass !== doc.weightClass ||
        current.total !== doc.total ||
        current.percentA !== doc.percentA
      ) {
        counts.updated += 1;
        writes.push({ id: current._id, doc });
      } else {
        counts.unchanged += 1;
      }
    }
    const deletions = [...existingByKey.entries()].filter(([key]) => !incoming.has(key)).map(([, row]) => row);
    counts.deleted = deletions.length;
    for (const row of deletions) await ctx.db.delete(row._id);
    for (const { id, doc } of writes) {
      if (id) await ctx.db.replace(id, doc);
      else await ctx.db.insert('intl_rankings', doc);
    }
    if (counts.inserted + counts.updated + counts.deleted > 0) {
      await recordWrite(ctx, 'intl_rankings', [{ kind: 'table', key: 'intl_rankings' }]);
    }
    return counts;
  },
});

/**
 * Deletes every international rankings group not in `groups` (the ones the
 * page still links), `delete_missing_intl_ranking_groups` in the Python
 * writer. An empty list deletes nothing.
 */
export const deleteMissingIntlRankingGroups = internalMutation({
  args: { groups: v.array(v.object({ meet: v.string(), gender: v.string(), ageCategory: v.string() })) },
  handler: async (ctx, { groups }) => {
    const active = new Set(
      groups
        .map((g) => ({ meet: g.meet, gender: normalizeGender(g.gender), ageCategory: normalizeAgeCategory(g.ageCategory) }))
        .filter((g) => g.meet && g.gender && g.ageCategory)
        .map((g) => JSON.stringify([g.meet, g.gender, g.ageCategory])),
    );
    if (active.size === 0) return { deletedGroups: [], deleted: 0 };
    const byGroup = new Map<string, { meet: string; gender: string; ageCategory: string; ids: (typeof rows)[number]['_id'][] }>();
    const rows = await ctx.db.query('intl_rankings').collect();
    for (const row of rows) {
      const key = JSON.stringify([row.meet ?? null, row.gender ?? null, row.ageCategory ?? null]);
      if (active.has(key)) continue;
      const group = byGroup.get(key) ?? { meet: row.meet ?? '', gender: row.gender ?? '', ageCategory: row.ageCategory ?? '', ids: [] };
      group.ids.push(row._id);
      byGroup.set(key, group);
    }
    const deletedGroups = [];
    for (const group of byGroup.values()) {
      for (const id of group.ids) await ctx.db.delete(id);
      deletedGroups.push({ meet: group.meet, gender: group.gender, ageCategory: group.ageCategory, deleted: group.ids.length });
    }
    const deleted = deletedGroups.reduce((sum, g) => sum + g.deleted, 0);
    if (deleted > 0) await recordWrite(ctx, 'intl_rankings', [{ kind: 'table', key: 'intl_rankings' }]);
    return { deletedGroups, deleted };
  },
});
