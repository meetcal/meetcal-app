import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { normalizeName } from './lib/names';
import { normalizeAgeCategory, normalizeGender } from './lib/normalize';
import { canonicalMeetDate } from './lib/validation';
import { deleteResultRows, eventResultsByKey, recordWrite, sameEditionDates, sameResultValues } from './ingest';

const BACKFILL_PAGE_SIZE = 500;
/**
 * Result rows one dedupe mutation deletes at most: each deletion rewrites
 * its athlete's history (`ingest.RESULT_PRUNE_BATCH` for the same reason).
 */
const DEDUPE_BATCH = 200;

/**
 * Fills `lifting_results.nameKey` on rows written before it existed, or
 * under an older `normalizeName` (before NFC), a page per mutation, each
 * page scheduling the next so no single transaction comes near the write
 * limits; then starts `views:rebuildAll`, which rewrites the histories and
 * summaries under the new keys and deletes the old ones. Idempotent: rows
 * that already hold the right key are skipped, so it can be re-run after any
 * bulk load.
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

/**
 * The Postgres casing migration (`20260604130000_normalize_gender_age_casing`)
 * for the Convex copies of the reference tables, using the writer's own
 * normalizers; also what rewrites a `Male` / `Female` gender to `Men` /
 * `Women` (`normalizeGender`). When normalizing makes a row collide with
 * another on the table's natural key, the most recently written one is
 * kept, since that is the one a scraper wrote with normalized values. Run
 * for each table after a deploy that changes a normalizer:
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

/**
 * Rewrites `athletes.gender` to the one spelling per gender `normalizeGender`
 * writes (`Men` / `Women`; older rows hold `Male` / `Female`), a page per
 * mutation, each scheduling the next. Writes through `recordWrite`, so the
 * meets' views follow. Idempotent. The athlete answers give `Male` /
 * `Female` either way (`athleteGenderLabel`).
 *
 *   npx convex run migrations:normalizeAthleteGenders
 */
export const normalizeAthleteGenders = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), patched: v.optional(v.number()) },
  handler: async (ctx, { cursor, patched = 0 }) => {
    const page = await ctx.db.query('athletes').paginate({ cursor: cursor ?? null, numItems: BACKFILL_PAGE_SIZE });
    const meets = new Set<string>();
    let count = patched;
    for (const row of page.page) {
      const gender = normalizeGender(row.gender);
      if (gender === row.gender) continue;
      await ctx.db.patch(row._id, { gender });
      meets.add(row.meet);
      count += 1;
    }
    if (meets.size > 0) {
      await recordWrite(ctx, 'athletes', [...[...meets].map((meet) => ({ kind: 'meet', key: meet })), { kind: 'table', key: 'athletes' }]);
    }
    if (page.isDone) {
      console.log(`normalizeAthleteGenders: done, ${count} athletes patched`);
      return;
    }
    await ctx.scheduler.runAfter(0, internal.migrations.normalizeAthleteGenders, { cursor: page.continueCursor, patched: count });
  },
});

/** Two stored rows that are one result twice: one edition (`sameEditionDates`), the same values, federation and adaptive flag. */
function isCopy(a: Doc<'lifting_results'>, b: Doc<'lifting_results'>): boolean {
  return sameEditionDates(a.date, b.date) && sameResultValues(a, b) && a.federation === b.federation && a.adaptive === b.adaptive;
}

/** Identities one log line lists: Convex keeps a bounded number of log lines per function run. */
const LEFT_PER_LOG_LINE = 50;

/**
 * Splits one identity's stored rows (oldest first) into sets of copies of
 * one result (`isCopy`), each in the order the rows were stored.
 */
function copySets(rows: readonly Doc<'lifting_results'>[]): Doc<'lifting_results'>[][] {
  const sets: Doc<'lifting_results'>[][] = [];
  for (const row of rows) {
    const set = sets.find((candidate) => isCopy(candidate[0], row));
    if (set) set.push(row);
    else sets.push([row]);
  }
  return sets;
}

/**
 * Deletes result rows stored twice: under one identity (`ingest.resultKey`:
 * event, meet, folded name, age category) in one edition of the meet
 * (dated within `ingest.SAME_EDITION_DAYS`), with the same body weight, attempts, bests, total, federation and adaptive flag. The
 * writers allowed such copies while they matched exact names ("John Smith"
 * and "John  Smith"). Of each set of copies the newest row is kept (the
 * source's latest spelling), taking the pre-Convex serial (`legacyId`) of
 * an older copy when it has none.
 *
 * Rows under one identity that are not copies are never deleted: another
 * edition's result under an event id the pre-Convex import reused across
 * a meet's editions (#369), or two sets of values for one result. Each such
 * identity is logged ("dedupeLiftingResults: left …") for a person to
 * resolve. `dryRun` deletes nothing and logs the same, with what it would
 * delete counted. Walks the results in event order a page per mutation,
 * reading each event whole once, and deletes through the ingest path, so
 * histories, summaries, views and search follow. Idempotent.
 *
 *   npx convex run migrations:dedupeLiftingResults '{"dryRun":true}'
 *   npx convex run migrations:dedupeLiftingResults
 */
export const dedupeLiftingResults = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    lastEventId: v.optional(v.string()),
    deleted: v.optional(v.number()),
    left: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, { cursor, lastEventId, deleted = 0, left = 0, dryRun = false }) => {
    const page = await ctx.db
      .query('lifting_results')
      .withIndex('by_event_and_name')
      .paginate({ cursor: cursor ?? null, numItems: BACKFILL_PAGE_SIZE });
    // Rows come in event order: an event already read is the one the
    // previous page ended in.
    const events = [...new Set(page.page.map((row) => row.eventId))].filter((eventId) => eventId !== lastEventId);
    const sets: Doc<'lifting_results'>[][] = [];
    const unresolved: string[] = [];
    for (const eventId of events) {
      for (const rows of (await eventResultsByKey(ctx, eventId)).values()) {
        const identity = copySets(rows);
        sets.push(...identity.filter((set) => set.length > 1));
        if (identity.length > 1) {
          const { meet, name, age } = rows[0];
          const values = identity.map((set) => `${set[0].date} total ${set[0].total ?? '-'} bw ${set[0].bodyWeight ?? '-'}${set.length > 1 ? ` (x${set.length})` : ''}`);
          unresolved.push(`event ${eventId} ${JSON.stringify(meet)} ${JSON.stringify(name)} ${age ?? '(no age)'}: ${values.join('; ')}`);
        }
      }
    }
    const total = sets.reduce((sum, set) => sum + set.length - 1, 0);
    let removed = 0;
    if (dryRun) {
      removed = total;
    } else {
      // Each set's older rows, newest kept, up to DEDUPE_BATCH deletions.
      const doomed: Doc<'lifting_results'>[] = [];
      for (const set of sets) {
        const kept = set[set.length - 1];
        const older = set.slice(0, -1).slice(0, DEDUPE_BATCH - doomed.length);
        if (older.length === 0) break;
        const legacyId = kept.legacyId ?? older.find((row) => row.legacyId !== undefined)?.legacyId;
        if (legacyId !== kept.legacyId) await ctx.db.patch(kept._id, { legacyId });
        doomed.push(...older);
      }
      removed = await deleteResultRows(ctx, doomed);
      if (total > DEDUPE_BATCH) {
        // The same page again: the deleted copies are gone, the rest are next.
        await ctx.scheduler.runAfter(0, internal.migrations.dedupeLiftingResults, {
          cursor: cursor ?? null,
          deleted: deleted + removed,
          left,
          ...(lastEventId === undefined ? {} : { lastEventId }),
        });
        return;
      }
    }
    // Logged once, on the pass that finishes the page.
    for (let i = 0; i < unresolved.length; i += LEFT_PER_LOG_LINE) {
      console.log(`dedupeLiftingResults: left\n${unresolved.slice(i, i + LEFT_PER_LOG_LINE).join('\n')}`);
    }
    const counts = { deleted: deleted + removed, left: left + unresolved.length };
    if (page.isDone) {
      console.log(
        `dedupeLiftingResults: done${dryRun ? ' (dry run)' : ''}, ${counts.deleted} duplicate rows ${dryRun ? 'to delete' : 'deleted'}, ` +
          `${counts.left} identities left for a person (logged above)`,
      );
      return;
    }
    await ctx.scheduler.runAfter(0, internal.migrations.dedupeLiftingResults, {
      cursor: page.continueCursor,
      lastEventId: page.page[page.page.length - 1]?.eventId ?? lastEventId,
      ...counts,
      ...(dryRun ? { dryRun } : {}),
    });
  },
});

/**
 * Meet names more than one meet row holds, oldest row first, with each
 * row's federation and dates, for a person to resolve (rename or delete one,
 * then `views:rebuildAll`). Every reader takes the oldest row of a name
 * (`meetByName`); the ingest mutations no longer create such pairs.
 *
 *   npx convex run migrations:duplicateMeetNames
 */
export const duplicateMeetNames = internalQuery({
  args: {},
  handler: async (ctx) => {
    const byName = new Map<string, Doc<'meets'>[]>();
    for (const meet of await ctx.db.query('meets').collect()) byName.set(meet.name, [...(byName.get(meet.name) ?? []), meet]);
    return [...byName]
      .filter(([, meets]) => meets.length > 1)
      .map(([name, meets]) => ({
        name,
        meets: meets
          .sort((a, b) => a._creationTime - b._creationTime)
          .map((meet) => ({ id: meet._id, federation: meet.federation ?? null, startDate: meet.startDate, endDate: meet.endDate, status: meet.status })),
      }));
  },
});

/**
 * Pads the meet dates the meet scraper once stored unpadded ("2026-9-5" ->
 * "2026-09-05"): meet dates are compared as text, so an unpadded one sorts
 * in the wrong place and its meet is never marked completed. A date that is
 * not a date at all ("undefined-TBD-undefined") is listed for a person
 * (`scrapers/queries:meetDataProblems`), not guessed at. Idempotent; writes
 * through `recordWrite`, so the meets' views follow.
 *
 *   npx convex run migrations:padMeetDates
 */
export const padMeetDates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const hints: { kind: 'meet'; key: string }[] = [];
    const unreadable: string[] = [];
    for (const meet of await ctx.db.query('meets').collect()) {
      const startDate = canonicalMeetDate(meet.startDate);
      const endDate = canonicalMeetDate(meet.endDate);
      if (startDate === null || endDate === null) {
        unreadable.push(meet.name);
        continue;
      }
      if (startDate === meet.startDate && endDate === meet.endDate) continue;
      await ctx.db.patch(meet._id, { startDate, endDate, updatedAt: Date.now() });
      hints.push({ kind: 'meet', key: meet.name });
    }
    if (hints.length > 0) await recordWrite(ctx, 'meets', hints);
    return { padded: hints.map((hint) => hint.key), unreadable };
  },
});

/**
 * Meet rows that are no event, found on production in October 2026 (#405),
 * by name and start date (names are not unique across federations): two
 * test entries with a venue of "q" and an unreadable zone, and a row of the
 * retired Python events scraper that took another event's dates ("2025 World
 * Masters Championships", dated March 2026 in "Aisling, CT").
 */
const BOGUS_MEETS_2026_10 = [
  { name: 'Virus Weightlifting Series 1', startDate: '2025-02-27' },
  { name: "USAMW Master's Nationals", startDate: '2025-03-26' },
  { name: '2025 World Masters Championships', startDate: '2026-03-06' },
];

/**
 * Deletes the meet rows named (by name and start date; by default
 * `BOGUS_MEETS_2026_10`), but only a meet nothing refers to: no schedule,
 * roster, result or saved session under its name (a meet is identified by
 * name everywhere). A meet that has any is listed in `kept` for a person;
 * a name and date no row has, in `missing`. Each row it deletes (or would)
 * is reported with its federation, dates, place and zone. Writes a meet hint
 * through `recordWrite`, so the meet's views and the meet index follow.
 * Idempotent; run with `dryRun` first and check every row it lists.
 *
 *   npx convex run migrations:deleteMeetsWithoutData '{"dryRun":true}'
 */
export const deleteMeetsWithoutData = internalMutation({
  args: { meets: v.optional(v.array(v.object({ name: v.string(), startDate: v.string() }))), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { meets = BOGUS_MEETS_2026_10, dryRun }) => {
    const deleted: { id: string; name: string; federation: string | null; startDate: string; endDate: string; place: string; timeZone: string }[] = [];
    const kept: { name: string; has: string[] }[] = [];
    const missing: string[] = [];
    // Saved sessions have no index by meet: read once, for every name.
    const names = new Set(meets.map((m) => m.name));
    const saved = new Set<string>();
    for await (const session of ctx.db.query('saved_sessions')) if (names.has(session.meet)) saved.add(session.meet);
    const hints: { kind: 'meet'; key: string }[] = [];
    for (const { name, startDate } of meets) {
      const rows = (
        await ctx.db
          .query('meets')
          .withIndex('by_name', (q) => q.eq('name', name))
          .collect()
      ).filter((row) => row.startDate === startDate);
      if (!rows.length) {
        missing.push(`${name} (${startDate})`);
        continue;
      }
      const has: string[] = [];
      if (await ctx.db.query('session_schedule').withIndex('by_meet', (q) => q.eq('meet', name)).first()) has.push('schedule');
      if (await ctx.db.query('athletes').withIndex('by_meet', (q) => q.eq('meet', name)).first()) has.push('roster');
      if (await ctx.db.query('lifting_results').withIndex('by_meet', (q) => q.eq('meet', name)).first()) has.push('results');
      if (saved.has(name)) has.push('saved sessions');
      if (has.length) {
        kept.push({ name, has });
        continue;
      }
      for (const row of rows) {
        if (!dryRun) await ctx.db.delete(row._id);
        deleted.push({
          id: row._id,
          name,
          federation: row.federation ?? null,
          startDate: row.startDate,
          endDate: row.endDate,
          place: [row.venueName, row.venueCity, row.venueState].join(' / '),
          timeZone: row.timeZone,
        });
      }
      hints.push({ kind: 'meet', key: name });
    }
    if (!dryRun && hints.length) await recordWrite(ctx, 'meets', hints);
    return { dryRun: dryRun ?? false, deleted, kept, missing };
  },
});
