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
  recordHolder,
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
    const updatedAt = Date.now();
    if (existing) await ctx.db.patch(existing._id, { seq: (existing.seq ?? 0) + 1, updatedAt });
    else await ctx.db.insert('view_hints', { ...hint, seq: 0, updatedAt });
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
      // The pre-Convex serial is the row's identity, not a value the scrapers
      // send: kept, and left out of the comparison.
      const { _id, _creationTime, legacyId, ...current } = existing;
      if (sameValues(current, doc)) {
        unchanged += 1;
        continue;
      }
      hints.push(...resultHints(existing));
      await ctx.db.replace(_id, { ...doc, legacyId });
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

const PLACEHOLDERS = new Set(['', 'TBD', 'Unknown']);

/**
 * USA Masters events from usamasters.net, upserted. An event is matched to
 * the USAMW meet stored under its name (case and spacing folded); the site's
 * names often differ from the stored ones ("2027 National Masters" vs "2027
 * USA Masters Nationals"), so failing that, to the one unclaimed USAMW meet
 * whose dates overlap. Several overlapping meets is ambiguous and reported,
 * not guessed. A new event is inserted. A match takes every
 * value the site gives (dates, venue, city, state, time zone); fields the
 * site leaves blank keep what is stored, and a move to another city clears
 * the old venue's street and zip. The stored name is kept: athletes and
 * results refer to a meet by name.
 */
export const syncUsamwEvents = internalMutation({
  args: { events: v.array(v.object({ name: v.string(), startDate: v.string(), endDate: v.string(), venueName: v.string(), venueCity: v.string(), venueState: v.string(), timeZone: v.string() })) },
  handler: async (ctx, { events }) => {
    const now = Date.now();
    const hints: WriteHint[] = [];
    const result = { inserted: [] as string[], updated: [] as string[], unchanged: [] as string[], ambiguous: [] as string[] };
    // Every USAMW meet that has not ended before the earliest event.
    const earliest = events.reduce((min, e) => (e.startDate < min ? e.startDate : min), '9999-12-31');
    const usamw = (
      await ctx.db
        .query('meets')
        .withIndex('by_end_date', (q) => q.gte('endDate', earliest))
        .collect()
    ).filter((meet) => meet.federation === 'USAMW');
    // A meet stored under the event's own name (folded) is that event; those
    // are claimed first, so a date match never takes another event's meet.
    const byName = new Map<number, Doc<'meets'>>();
    const claimed = new Set<string>();
    events.forEach((event, i) => {
      const named = usamw.find((meet) => normalizeName(meet.name) === normalizeName(event.name) && !claimed.has(meet._id));
      if (named) {
        byName.set(i, named);
        claimed.add(named._id);
      }
    });
    for (const [i, event] of events.entries()) {
      let match = byName.get(i);
      if (!match) {
        // Otherwise the one unclaimed USAMW meet whose dates overlap; two or
        // more is ambiguous (two events on one weekend), left for a person.
        const overlapping = usamw.filter((meet) => !claimed.has(meet._id) && meet.startDate <= event.endDate && meet.endDate >= event.startDate);
        if (overlapping.length > 1) {
          result.ambiguous.push(`${event.name}: ${overlapping.map((meet) => meet.name).join(' / ')}`);
          continue;
        }
        match = overlapping[0];
        if (match) claimed.add(match._id);
      }
      if (!match) {
        await ctx.db.insert('meets', {
          ...event,
          venueStreet: 'TBD',
          venueZip: 'TBD',
          status: 'upcoming',
          federation: 'USAMW',
          updatedAt: now,
        });
        hints.push({ kind: 'meet', key: event.name });
        result.inserted.push(event.name);
        continue;
      }
      const site: Partial<Doc<'meets'>> = { startDate: event.startDate, endDate: event.endDate };
      for (const field of ['venueName', 'venueCity', 'venueState'] as const) {
        if (!PLACEHOLDERS.has(event[field])) site[field] = event[field];
      }
      if (site.venueState) site.timeZone = event.timeZone;
      if (site.venueCity && site.venueCity !== match.venueCity) {
        site.venueStreet = 'TBD';
        site.venueZip = 'TBD';
        site.venueName ??= 'TBD';
      }
      const patch = Object.fromEntries(Object.entries(site).filter(([key, value]) => match[key as keyof typeof site] !== value)) as Partial<Doc<'meets'>>;
      if (Object.keys(patch).length === 0) {
        result.unchanged.push(match.name);
        continue;
      }
      await ctx.db.patch(match._id, { ...patch, updatedAt: now });
      hints.push({ kind: 'meet', key: match.name });
      result.updated.push(`${match.name} (${Object.entries(patch).map(([k, value]) => `${k} ${match[k as keyof typeof patch] ?? ''} -> ${value}`).join(', ')})`);
    }
    if (hints.length) await recordWrite(ctx, 'meets', hints);
    return result;
  },
});

const entryRow = v.object({
  memberId: v.string(),
  name: v.string(),
  age: v.number(),
  club: v.string(),
  gender: v.string(),
  weightClass: v.string(),
  entryTotal: v.number(),
  meet: v.string(),
});

const isPlaceholderMemberId = (id: string) => id === '' || id.startsWith('noid:');

/**
 * One meet's Sport80 entries (`upsert_athlete(..., preserve_assigned_session=True)`).
 * An athlete with a membership number is the row with that number and name
 * (names compared case- and space-insensitively) at the meet; one without is
 * the row with the same name and gender carrying a blank or placeholder id,
 * or an older row with a one-off nine-digit id and the same age (ids the old
 * scraper minted per run: a real membership number recurs at other meets).
 * Rows already given a session are left alone, so entries never undo a
 * published start list. Entries are not deleted when they leave the list.
 */
export const upsertEntryAthletes = internalMutation({
  args: { meet: v.string(), rows: v.array(entryRow) },
  handler: async (ctx, { meet, rows }) => {
    if (rows.some((row) => row.meet !== meet)) throw new Error('every row must belong to `meet`');
    const existing = await ctx.db
      .query('athletes')
      .withIndex('by_meet', (q) => q.eq('meet', meet))
      .collect();
    const counts = { inserted: 0, updated: 0, unchanged: 0, sessionSkipped: 0 };
    const oneOffIds = new Map<string, boolean>();
    const isOneOff = async (memberId: string) => {
      if (!/^[1-9]\d{8}$/.test(memberId)) return false;
      if (!oneOffIds.has(memberId)) {
        const elsewhere = await ctx.db
          .query('athletes')
          .withIndex('by_memberId', (q) => q.eq('memberId', memberId))
          .filter((q) => q.neq(q.field('meet'), meet))
          .first();
        oneOffIds.set(memberId, elsewhere === null);
      }
      return oneOffIds.get(memberId)!;
    };
    for (const row of rows) {
      const gender = normalizeGender(row.gender);
      const nameKey = normalizeName(row.name);
      const idless = isPlaceholderMemberId(row.memberId);
      let match: Doc<'athletes'> | undefined;
      if (idless) {
        const sameName = existing.filter((a) => normalizeName(a.name) === nameKey && a.gender === gender);
        match = sameName.find((a) => isPlaceholderMemberId(a.memberId));
        for (const a of sameName) {
          if (match) break;
          if (a.age === row.age && (await isOneOff(a.memberId))) match = a;
        }
      } else {
        match = existing.find((a) => a.memberId === row.memberId && normalizeName(a.name) === nameKey);
      }
      const values = {
        // An adopted older row keeps its id rather than take a placeholder.
        memberId: idless && match && !isPlaceholderMemberId(match.memberId) ? match.memberId : row.memberId,
        name: row.name,
        age: row.age,
        club: row.club,
        gender,
        weightClass: row.weightClass,
        entryTotal: row.entryTotal,
      };
      if (!match) {
        const doc = { ...values, meet, adaptive: false };
        existing.push({ ...doc, _id: await ctx.db.insert('athletes', doc), _creationTime: Date.now() });
        counts.inserted += 1;
        continue;
      }
      if (match.sessionNumber !== undefined || (match.sessionPlatform ?? '').trim() !== '') {
        counts.sessionSkipped += 1;
        continue;
      }
      const changed = (Object.keys(values) as (keyof typeof values)[]).some((key) => match[key] !== values[key]);
      if (!changed) {
        counts.unchanged += 1;
        continue;
      }
      await ctx.db.patch(match._id, values);
      Object.assign(match, values);
      counts.updated += 1;
    }
    // The club list is built from every athlete, so it needs the table hint too.
    if (counts.inserted + counts.updated > 0) {
      await recordWrite(ctx, 'athletes', [
        { kind: 'meet', key: meet },
        { kind: 'table', key: 'athletes' },
      ]);
    }
    return counts;
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

type Holder = { name: string; date?: string; location?: string };
type Lifts = { snatchRecord?: number; cjRecord?: number; totalRecord?: number; snatchBy?: Holder; cjBy?: Holder; totalBy?: Holder };

const holderKey = (holder: Holder | undefined) => (holder ? JSON.stringify([holder.name, holder.date ?? null, holder.location ?? null]) : '');

/** Whether a record's lifts or their holders differ from what is stored. */
function liftsChanged(stored: Lifts, next: Lifts): boolean {
  return (
    stored.snatchRecord !== next.snatchRecord ||
    stored.cjRecord !== next.cjRecord ||
    stored.totalRecord !== next.totalRecord ||
    holderKey(stored.snatchBy) !== holderKey(next.snatchBy) ||
    holderKey(stored.cjBy) !== holderKey(next.cjBy) ||
    holderKey(stored.totalBy) !== holderKey(next.totalBy)
  );
}

const holderArgs = { snatchBy: v.optional(recordHolder), cjBy: v.optional(recordHolder), totalBy: v.optional(recordHolder) };

const recordRow = v.object({
  recordType: v.string(),
  ageCategory: v.string(),
  gender: v.string(),
  weightClass: v.string(),
  snatchRecord: v.optional(v.number()),
  cjRecord: v.optional(v.number()),
  totalRecord: v.optional(v.number()),
  ...holderArgs,
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
        snatchBy: row.snatchBy,
        cjBy: row.cjBy,
        totalBy: row.totalBy,
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
      } else if (liftsChanged(existing, doc)) {
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

/**
 * Exact-set sync of one record type (`replace_records`, e.g. IWF world
 * records): classes missing from the payload are deleted, the rest written
 * only where they changed. An empty payload or a duplicate class is refused.
 */
export const replaceRecordSet = internalMutation({
  args: { recordType: v.string(), rows: v.array(recordRow) },
  handler: async (ctx, { recordType, rows }) => {
    if (!recordType) throw new Error('recordType is required');
    if (!rows.length) throw new Error(`refusing to replace ${recordType} records with an empty payload`);
    const keyOf = (r: { ageCategory: string; gender: string; weightClass: string }) => JSON.stringify([r.ageCategory, r.gender, r.weightClass]);
    const existing = new Map(
      (await ctx.db.query('records').withIndex('by_record_type', (q) => q.eq('recordType', recordType)).collect()).map((r) => [keyOf(r), r]),
    );
    const counts = { inserted: 0, updated: 0, deleted: 0, unchanged: 0 };
    const changes: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.recordType !== recordType) throw new Error(`row of type ${row.recordType} in a ${recordType} replace`);
      const doc = {
        recordType,
        ageCategory: normalizeAgeCategory(row.ageCategory),
        gender: normalizeGender(row.gender),
        weightClass: row.weightClass,
        snatchRecord: row.snatchRecord,
        cjRecord: row.cjRecord,
        totalRecord: row.totalRecord,
        snatchBy: row.snatchBy,
        cjBy: row.cjBy,
        totalBy: row.totalBy,
      };
      const key = keyOf(doc);
      if (seen.has(key)) throw new Error(`Duplicate ${recordType} record in payload: ${key}`);
      seen.add(key);
      const current = existing.get(key);
      const label = `${doc.ageCategory} ${doc.gender} ${doc.weightClass}`;
      if (!current) {
        await ctx.db.insert('records', doc);
        counts.inserted += 1;
      } else if (liftsChanged(current, doc)) {
        await ctx.db.replace(current._id, doc);
        counts.updated += 1;
        changes.push(`${label}: ${current.snatchRecord}/${current.cjRecord}/${current.totalRecord} -> ${doc.snatchRecord}/${doc.cjRecord}/${doc.totalRecord}`);
      } else counts.unchanged += 1;
    }
    for (const [key, row] of existing) {
      if (seen.has(key)) continue;
      await ctx.db.delete(row._id);
      counts.deleted += 1;
    }
    if (counts.inserted + counts.updated + counts.deleted > 0) await recordWrite(ctx, 'records', [{ kind: 'table', key: 'records' }]);
    return { ...counts, changes };
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

const wsoRecordRow = v.object({
  wso: v.string(),
  ageCategory: v.string(),
  gender: v.string(),
  weightClass: v.string(),
  snatchRecord: v.optional(v.number()),
  cjRecord: v.optional(v.number()),
  totalRecord: v.optional(v.number()),
  ...holderArgs,
});

/**
 * Exact-set sync of one WSO's records (`replace_wso_records`): rows missing
 * from the payload are deleted, the rest written only where they changed.
 * An empty payload or a duplicate class is refused, since either would mean
 * a bad parse rather than a WSO without records.
 */
export const replaceWsoRecordSet = internalMutation({
  args: { wso: v.string(), rows: v.array(wsoRecordRow) },
  handler: async (ctx, { wso, rows }) => {
    if (!wso) throw new Error('wso is required');
    if (!rows.length) throw new Error(`refusing to replace ${wso} WSO records with an empty payload`);
    const keyOf = (r: { ageCategory: string; gender: string; weightClass: string }) => JSON.stringify([r.ageCategory, r.gender, r.weightClass]);
    const existing = new Map((await ctx.db.query('wso_records').withIndex('by_wso', (q) => q.eq('wso', wso)).collect()).map((r) => [keyOf(r), r]));
    const counts = { inserted: 0, updated: 0, deleted: 0, unchanged: 0 };
    const seen = new Set<string>();
    for (const row of rows) {
      const doc = {
        wso,
        ageCategory: normalizeAgeCategory(row.ageCategory),
        gender: normalizeGender(row.gender),
        weightClass: row.weightClass,
        snatchRecord: row.snatchRecord,
        cjRecord: row.cjRecord,
        totalRecord: row.totalRecord,
        snatchBy: row.snatchBy,
        cjBy: row.cjBy,
        totalBy: row.totalBy,
      };
      const key = keyOf(doc);
      if (seen.has(key)) throw new Error(`Duplicate WSO record in payload: ${key}`);
      seen.add(key);
      const current = existing.get(key);
      if (!current) {
        await ctx.db.insert('wso_records', doc);
        counts.inserted += 1;
      } else if (liftsChanged(current, doc)) {
        await ctx.db.replace(current._id, doc);
        counts.updated += 1;
      } else counts.unchanged += 1;
    }
    for (const [key, row] of existing) {
      if (seen.has(key)) continue;
      await ctx.db.delete(row._id);
      counts.deleted += 1;
    }
    if (counts.inserted + counts.updated + counts.deleted > 0) await recordWrite(ctx, 'wso_records', [{ kind: 'table', key: 'wso_records' }]);
    return counts;
  },
});

/**
 * Inserts or updates WSO records matched on (wso, age, gender, class),
 * normalized like `upsert_wso_record`; a lift missing from the row clears it,
 * as the Python writer's None did. Never deletes.
 */
export const upsertWsoRecords = internalMutation({
  args: { rows: v.array(wsoRecordRow) },
  handler: async (ctx, { rows }): Promise<UpsertOutcome[]> => {
    const outcomes: UpsertOutcome[] = [];
    for (const row of rows) {
      const doc = {
        wso: row.wso,
        ageCategory: normalizeAgeCategory(row.ageCategory),
        gender: normalizeGender(row.gender),
        weightClass: row.weightClass,
        snatchRecord: row.snatchRecord,
        cjRecord: row.cjRecord,
        totalRecord: row.totalRecord,
        snatchBy: row.snatchBy,
        cjBy: row.cjBy,
        totalBy: row.totalBy,
      };
      const existing = (
        await ctx.db
          .query('wso_records')
          .withIndex('by_wso_age_gender', (q) => q.eq('wso', doc.wso).eq('ageCategory', doc.ageCategory).eq('gender', doc.gender))
          .collect()
      ).find((r) => r.weightClass === doc.weightClass);
      if (!existing) {
        await ctx.db.insert('wso_records', doc);
        outcomes.push({ wasInsert: true, wasChanged: true });
      } else if (liftsChanged(existing, doc)) {
        await ctx.db.replace(existing._id, doc);
        outcomes.push({ wasInsert: false, wasChanged: true });
      } else {
        outcomes.push({ wasInsert: false, wasChanged: false });
      }
    }
    if (outcomes.some((o) => o.wasChanged)) await recordWrite(ctx, 'wso_records', [{ kind: 'table', key: 'wso_records' }]);
    return outcomes;
  },
});
