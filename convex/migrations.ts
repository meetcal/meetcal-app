import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { normalizeName } from './lib/names';
import { normalizeAgeCategory, normalizeGender } from './lib/normalize';
import { canonicalMeetDate, isValidIsoDate } from './lib/validation';
import { writeHistories } from './lib/history';
import { bareWeightClass, hasSession, isJunkEntrant, isJunkMeetName } from './lib/roster';
import {
  athleteKeys,
  deleteResultRows,
  eventResultsByKey,
  recordWrite,
  resultHints,
  sameEditionDates,
  sameResultValues,
  type WriteHint,
} from './ingest';

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

/** A membership number the old entries scraper minted per run (`ingest.upsertEntryAthletes`). */
const ONE_OFF_MEMBER_ID = /^[1-9]\d{8}$/;

/**
 * Why a roster row is a leftover of an old entries scraper, or null for a
 * row to keep (#384, #386), given every row of its meet and whether the meet
 * name is page chrome with no meet row:
 * - `junk meet`: the meet is named after a cookie banner or a CSV line;
 * - `placeholder`: Sport80's empty-table placeholder (`undefined undefined`);
 * - `start list copy`: an unscheduled row of a meet whose start list is out,
 *   with the folded name, gender and weight class of a scheduled one (added
 *   before #133 was fixed);
 * - `stale one-off id`: an unscheduled row with a nine-digit id the old
 *   scraper minted, beside a row of the same name, gender and age (within a
 *   year) with a real one.
 */
export function rosterLeftover(row: Doc<'athletes'>, meetRows: readonly Doc<'athletes'>[], junkMeet: boolean): string | null {
  if (junkMeet) return 'junk meet';
  if (isJunkEntrant(row)) return 'placeholder';
  if (hasSession(row)) return null;
  const key = normalizeName(row.name);
  // The same athlete: the folded name, gender and, for a copy, weight class
  // (another athlete of the same name keeps their row, and an ambiguous one
  // is left for a person).
  const same = meetRows.filter(
    (other) => other._id !== row._id && normalizeName(other.name) === key && normalizeGender(other.gender) === normalizeGender(row.gender),
  );
  if (same.some((other) => hasSession(other) && bareWeightClass(other.weightClass) === bareWeightClass(row.weightClass))) return 'start list copy';
  if (
    ONE_OFF_MEMBER_ID.test(row.memberId) &&
    same.some((other) => Math.abs(other.age - row.age) <= 1 && !ONE_OFF_MEMBER_ID.test(other.memberId) && !other.memberId.startsWith('noid:'))
  ) {
    return 'stale one-off id';
  }
  return null;
}

/**
 * Deletes the roster rows old entries scrapers left (`rosterLeftover`):
 * placeholder entrants, meets named after page chrome, unscheduled copies of
 * start-list athletes, and one-off ids beside the athlete's real number
 * (#384, #386). Dry run by default: logs each meet's rows by reason and
 * deletes nothing. Walks the roster in meet order a page per mutation,
 * reading each meet whole once; deletes through `recordWrite`, so the
 * meets' views and the club list follow. Idempotent.
 *
 *   npx convex run migrations:cleanupRosterRows
 *   npx convex run migrations:cleanupRosterRows '{"dryRun":false}'
 */
export const cleanupRosterRows = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    lastMeet: v.optional(v.string()),
    deleted: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, { cursor, lastMeet, deleted = 0, dryRun = true }) => {
    const page = await ctx.db
      .query('athletes')
      .withIndex('by_meet')
      .paginate({ cursor: cursor ?? null, numItems: BACKFILL_PAGE_SIZE });
    const meets = [...new Set(page.page.map((row) => row.meet))].filter((meet) => meet !== lastMeet);
    const found: string[] = [];
    let count = deleted;
    for (const meet of meets) {
      const rows = await ctx.db
        .query('athletes')
        .withIndex('by_meet', (q) => q.eq('meet', meet))
        .collect();
      const junkMeet =
        isJunkMeetName(meet) &&
        (await ctx.db
          .query('meets')
          .withIndex('by_name', (q) => q.eq('name', meet))
          .first()) === null;
      const candidates = rows.flatMap((row) => {
        const reason = rosterLeftover(row, rows, junkMeet);
        return reason === null ? [] : [{ row, reason }];
      });
      // A nine-digit id another meet also holds is a real membership number,
      // not one the old scraper minted per run (as `upsertEntryAthletes`
      // judges it): kept.
      const doomed = [];
      for (const candidate of candidates) {
        if (candidate.reason === 'stale one-off id') {
          const elsewhere = await ctx.db
            .query('athletes')
            .withIndex('by_memberId', (q) => q.eq('memberId', candidate.row.memberId))
            .filter((q) => q.neq(q.field('meet'), meet))
            .first();
          if (elsewhere) continue;
        }
        doomed.push(candidate);
      }
      if (doomed.length === 0) continue;
      const reasons: Record<string, number> = {};
      for (const { reason } of doomed) reasons[reason] = (reasons[reason] ?? 0) + 1;
      const examples = doomed.slice(0, 3).map(({ row, reason }) => `${row.name} (${row.memberId}, ${reason})`);
      found.push(`${JSON.stringify(meet)}: ${doomed.length} of ${rows.length} ${JSON.stringify(reasons)}, e.g. ${examples.join('; ')}`);
      count += doomed.length;
      if (dryRun) continue;
      for (const { row } of doomed) await ctx.db.delete(row._id);
      await recordWrite(ctx, 'athletes', [
        { kind: 'meet', key: meet },
        { kind: 'table', key: 'athletes' },
      ]);
    }
    for (let i = 0; i < found.length; i += LEFT_PER_LOG_LINE) {
      console.log(`cleanupRosterRows${dryRun ? ' (dry run)' : ''}:\n${found.slice(i, i + LEFT_PER_LOG_LINE).join('\n')}`);
    }
    if (page.isDone) {
      console.log(`cleanupRosterRows: done${dryRun ? ' (dry run)' : ''}, ${count} roster rows ${dryRun ? 'to delete' : 'deleted'}`);
      return;
    }
    await ctx.scheduler.runAfter(0, internal.migrations.cleanupRosterRows, {
      cursor: page.continueCursor,
      lastMeet: page.page[page.page.length - 1]?.meet ?? lastMeet,
      deleted: count,
      ...(dryRun ? {} : { dryRun }),
    });
  },
});

/**
 * Rows one re-date mutation patches at most: each rewrites its athlete's
 * history, as a batch of upserts does.
 */
const REDATE_BATCH = 200;
/** Rows on one date past which `redateEventResults` takes it for a real meet date, not one lifter's. */
const CROWDED_DATE_ROWS = 3;

/**
 * Gives an event's results stored under a wrong date the meet's date (#402):
 * an earlier loader stamped some events' rows with each lifter's birth date,
 * or with one day per lifter. `meet` names the rows (an event id the
 * pre-Convex import reused can hold another edition's rows under another
 * title, which are left alone); `date` defaults to the start date of the meet
 * stored under that name. Dry run by default: returns how many rows would
 * move and the dates they hold now. Patches at most REDATE_BATCH rows a call
 * (rerun until `remaining` is 0) through the write path, so histories,
 * summaries, rankings, views and search follow. Idempotent. Find the events
 * with `migrations:resultDateProblems`; afterwards, run
 * `migrations:dedupeLiftingResults` in case the current sync had also stored
 * the rows under the right date.
 *
 * Only dates that look like one lifter's each are moved. A date holding more
 * than CROWDED_DATE_ROWS rows is another edition of a meet whose event id
 * and title recur across years, or another day of the meet, and is never
 * moved unasked: the dry run lists such dates as `crowded`, and a run that
 * finds any refuses until each is listed in `keepDates` (left as they are)
 * or `moveDates` (moved after all). `keepDates` also leaves any other date
 * alone.
 *
 *   npx convex run migrations:redateEventResults '{"eventId":"6959","meet":"4th Annual Steve Sakoulas Summer Open","date":"2025-07-12"}'
 *   npx convex run migrations:redateEventResults '{"eventId":"6959","meet":"4th Annual Steve Sakoulas Summer Open","date":"2025-07-12","dryRun":false}'
 */
export const redateEventResults = internalMutation({
  args: {
    eventId: v.string(),
    meet: v.string(),
    date: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
    keepDates: v.optional(v.array(v.string())),
    moveDates: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { eventId, meet, date, dryRun = true, keepDates = [], moveDates = [] }) => {
    const target =
      date ??
      (
        await ctx.db
          .query('meets')
          .withIndex('by_name', (q) => q.eq('name', meet))
          .first()
      )?.startDate;
    if (target === undefined) throw new Error(`no meet named ${JSON.stringify(meet)}: pass the event's "date"`);
    if (!isValidIsoDate(target)) throw new Error(`not a YYYY-MM-DD date: ${JSON.stringify(target)}`);
    const rows = (
      await ctx.db
        .query('lifting_results')
        .withIndex('by_event_and_name', (q) => q.eq('eventId', eventId))
        .collect()
    ).filter((row) => row.meet === meet);
    if (rows.length === 0) throw new Error(`event ${eventId} holds no results of ${JSON.stringify(meet)}`);
    const keep = new Set(keepDates);
    const move = new Set(moveDates);
    const wrong = rows.filter((row) => row.date !== target && !keep.has(row.date));
    const dates: Record<string, number> = {};
    for (const row of wrong) dates[row.date] = (dates[row.date] ?? 0) + 1;
    // Another edition or day of the meet, unless the caller said otherwise.
    const crowded = Object.entries(dates)
      .filter(([day, count]) => count > CROWDED_DATE_ROWS && !move.has(day))
      .map(([day]) => day)
      .sort();
    const summary = { date: target, rows: rows.length, wrong: wrong.length, dates, crowded };
    if (dryRun) return { ...summary, redated: 0, remaining: wrong.length };
    if (crowded.length > 0) {
      throw new Error(
        `event ${eventId} ${JSON.stringify(meet)} holds over ${CROWDED_DATE_ROWS} results on ${crowded.join(', ')}: another edition or day of the meet? ` +
          `List each in "keepDates" to leave it, or "moveDates" to move it`,
      );
    }
    const batch = wrong.slice(0, REDATE_BATCH);
    const hints: WriteHint[] = [];
    for (const row of batch) {
      hints.push(...resultHints(row), ...resultHints({ ...row, date: target }));
      await ctx.db.patch(row._id, { date: target });
    }
    if (batch.length > 0) {
      await writeHistories(ctx, athleteKeys(hints));
      await recordWrite(ctx, 'lifting_results', hints);
    }
    return { ...summary, redated: batch.length, remaining: wrong.length - batch.length };
  },
});

/** One event's rows under one meet title on one page of `resultDatePage`, counted by date. */
type EventDates = { eventId: string; meet: string; dates: Record<string, number> };

/** Rows `resultDatePage` reads per query. */
const RESULT_DATE_PAGE = 4000;

export const resultDatePage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }): Promise<{ groups: EventDates[]; cursor: string; isDone: boolean }> => {
    const page = await ctx.db
      .query('lifting_results')
      .withIndex('by_event_and_name')
      .paginate({ cursor, numItems: RESULT_DATE_PAGE });
    const groups = new Map<string, EventDates>();
    for (const row of page.page) {
      const id = JSON.stringify([row.eventId, row.meet]);
      const group = groups.get(id) ?? { eventId: row.eventId, meet: row.meet, dates: {} };
      group.dates[row.date] = (group.dates[row.date] ?? 0) + 1;
      groups.set(id, group);
    }
    return { groups: [...groups.values()], cursor: page.continueCursor, isDone: page.isDone };
  },
});

/** An event's distinct result dates past which they look like one per lifter, not a meet's days or editions. */
const MANY_DATES = 5;

/**
 * Whether an event's results under one title carry dates no meet has (#402):
 * nearly one date per lifter (birth dates, or a spreadsheet's dragged date
 * column), where a meet's rows share its date (a multi-day meet a few, an
 * event id the pre-Convex import reused across editions one per edition).
 */
export function suspectResultDates(dates: Record<string, number>): boolean {
  const counts = Object.values(dates);
  const rows = counts.reduce((sum, n) => sum + n, 0);
  return counts.length >= MANY_DATES && counts.length * 3 >= rows;
}

/**
 * Read-only: the events whose results carry suspect dates
 * (`suspectResultDates`), with their row count and date range, to repair
 * with `migrations:redateEventResults`. Reads every result a page per query.
 *
 *   npx convex run migrations:resultDateProblems
 */
export const resultDateProblems = internalAction({
  args: {},
  handler: async (ctx): Promise<{ eventId: string; meet: string; rows: number; dates: number; first: string; last: string }[]> => {
    const merged = new Map<string, EventDates>();
    let cursor: string | null = null;
    for (;;) {
      const page: { groups: EventDates[]; cursor: string; isDone: boolean } = await ctx.runQuery(internal.migrations.resultDatePage, { cursor });
      for (const group of page.groups) {
        const id = JSON.stringify([group.eventId, group.meet]);
        const into = merged.get(id);
        if (!into) merged.set(id, group);
        else for (const [date, n] of Object.entries(group.dates)) into.dates[date] = (into.dates[date] ?? 0) + n;
      }
      if (page.isDone) break;
      cursor = page.cursor;
    }
    return [...merged.values()]
      .filter((group) => suspectResultDates(group.dates))
      .map(({ eventId, meet, dates }) => {
        const sorted = Object.keys(dates).sort();
        return { eventId, meet, rows: Object.values(dates).reduce((sum, n) => sum + n, 0), dates: sorted.length, first: sorted[0], last: sorted[sorted.length - 1] };
      })
      .sort((a, b) => (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0));
  },
});
