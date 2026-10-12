import { v } from 'convex/values';
import { internalMutation, type MutationCtx } from './_generated/server';
import type { Doc, Id, TableNames } from './_generated/dataModel';
import { writeHistories } from './lib/history';
import { normalizeAgeCategory, normalizeFederation, normalizeGender, storedGenderSpellings } from './lib/normalize';
import { disambiguatedMeetName, oldestMeet, type ZoneFormatters } from './lib/meetData';
import { earliestLocalDate, meetStatusAt, type MeetStatus } from './lib/meetStatus';
import { normalizeName } from './lib/names';
import { bumpVersion, type SourceTable } from './lib/views';
import { clearedColumns, clearedLifts, exceedsShrink, liftCount } from './lib/shrinkGuard';
import { athletesFields, liftingResultsFields, recordHolder, sessionScheduleFields } from './schema';
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
 * A result row's identity within its event: the meet, the athlete's folded
 * name (`normalizeName`, so "John  Smith" and "john smith" are one athlete,
 * as their history is) and the age category (a lifter entered in Masters and
 * Open at one meet has a result in each). The one definition every result
 * writer matches on: the upsert, the delete and the Sport80 prune. Computed
 * from the name, never from a stored `nameKey`, so a row keyed by an older
 * rule still matches.
 */
export type ResultIdentity = { meet: string; name: string; age?: string | null };
export const resultKey = (row: ResultIdentity) => JSON.stringify([row.meet, normalizeName(row.name), row.age ?? null]);

/** One event's stored results by `resultKey`, oldest first within a key; read once per mutation. */
export async function eventResultsByKey(ctx: MutationCtx, eventId: string): Promise<Map<string, Doc<'lifting_results'>[]>> {
  const byKey = new Map<string, Doc<'lifting_results'>[]>();
  const rows = await ctx.db
    .query('lifting_results')
    .withIndex('by_event_and_name', (q) => q.eq('eventId', eventId))
    .collect();
  for (const row of rows.sort((a, b) => a._creationTime - b._creationTime)) {
    const key = resultKey(row);
    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  }
  return byKey;
}

/**
 * Of several stored rows under one identity (written before names were
 * matched folded), the one an incoming row updates: the same exact name if
 * there is one, else the oldest.
 */
function pickStored(rows: readonly Doc<'lifting_results'>[], name: string): Doc<'lifting_results'> {
  return rows.find((row) => row.name === name) ?? rows[0];
}

/**
 * Inserts or updates results, matched on (eventId, `resultKey`). `nameKey`
 * is derived here, never taken from the caller, and the federation is
 * normalized (`normalize_federation`). A row whose values are unchanged is
 * not written, so re-syncing an unchanged meet bumps no version and
 * invalidates no view. Stored copies of a row beyond the one it updates
 * (the same athlete stored under two spellings) are deleted. Without
 * `allowShrink`, a batch that empties a column (a lift, the total, the body
 * weight) on many of the stored rows it updates is refused, nothing written:
 * that is a column the source renamed, not a set of corrections.
 */
export const upsertLiftingResults = internalMutation({
  args: { rows: v.array(liftingResult), allowShrink: v.optional(v.boolean()) },
  handler: async (ctx, { rows, allowShrink }) => {
    const events = new Map<string, Map<string, Doc<'lifting_results'>[]>>();
    const storedUnder = async (row: (typeof rows)[number]) => {
      let byKey = events.get(row.eventId);
      if (!byKey) {
        byKey = await eventResultsByKey(ctx, row.eventId);
        events.set(row.eventId, byKey);
      }
      return { byKey, key: resultKey(row) };
    };
    if (!allowShrink) {
      const updates = [];
      for (const row of rows) {
        const { byKey, key } = await storedUnder(row);
        const matches = byKey.get(key);
        if (matches) updates.push({ stored: pickStored(matches, row.name), next: row });
      }
      const emptied = clearedColumns(updates);
      if (emptied.length) {
        throw new Error(
          `refusing to clear ${emptied.join(', ')} on most of ${updates.length} stored results (a source column renamed?). ` +
            `If the source really cleared them, rerun its sync with '{"allowShrink":true}'`,
        );
      }
    }
    const hints: WriteHint[] = [];
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let duplicates = 0;
    for (const row of rows) {
      const { legacyId: _legacy, nameKey: _key, ...fields } = row;
      const doc = {
        ...fields,
        federation: fields.federation === undefined ? undefined : normalizeFederation(fields.federation),
        nameKey: normalizeName(row.name),
      };
      // The map follows this batch's writes, so a row repeated in the
      // batch updates the first one's document.
      const { byKey, key } = await storedUnder(row);
      const matches = byKey.get(key) ?? [];
      if (matches.length === 0) {
        const _id = await ctx.db.insert('lifting_results', doc);
        byKey.set(key, [{ ...doc, _id, _creationTime: Date.now() }]);
        inserted += 1;
        hints.push(...resultHints(doc));
        continue;
      }
      const existing = pickStored(matches, row.name);
      for (const copy of matches) {
        if (copy === existing) continue;
        hints.push(...resultHints(copy));
        await ctx.db.delete(copy._id);
        duplicates += 1;
      }
      // The pre-Convex serial is the row's identity, not a value the scrapers
      // send: kept, and left out of the comparison.
      const { _id, _creationTime, legacyId, ...current } = existing;
      byKey.set(key, [{ ...doc, legacyId, _id, _creationTime }]);
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
    return { inserted, updated, unchanged, duplicates };
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

/**
 * Deletes result rows, rewriting their athletes' histories and leaving the
 * hints that update views and search, like every result write.
 */
export async function deleteResultRows(ctx: MutationCtx, rows: readonly Doc<'lifting_results'>[]): Promise<number> {
  const hints: WriteHint[] = [];
  for (const row of rows) {
    hints.push(...resultHints(row));
    await ctx.db.delete(row._id);
  }
  if (rows.length > 0) {
    await writeHistories(ctx, athleteKeys(hints));
    await recordWrite(ctx, 'lifting_results', hints);
  }
  return rows.length;
}

/**
 * Deletes results by the identity `upsertLiftingResults` writes them under
 * (eventId, `resultKey`): every stored spelling of the name. A key without
 * `age` deletes the athlete's rows in every age category of that meet; `age:
 * null` only a row stored without one.
 */
export const deleteLiftingResults = internalMutation({
  args: {
    keys: v.array(v.object({ eventId: v.string(), meet: v.string(), name: v.string(), age: v.optional(v.union(v.string(), v.null())) })),
  },
  handler: async (ctx, { keys }) => {
    const events = new Map<string, Map<string, Doc<'lifting_results'>[]>>();
    const rows = new Map<string, Doc<'lifting_results'>>();
    for (const key of keys) {
      let byKey = events.get(key.eventId);
      if (!byKey) {
        byKey = await eventResultsByKey(ctx, key.eventId);
        events.set(key.eventId, byKey);
      }
      const matches =
        key.age === undefined
          ? [...byKey.values()].flat().filter((row) => resultKey({ ...row, age: null }) === resultKey({ ...key, age: null }))
          : (byKey.get(resultKey(key)) ?? []);
      for (const row of matches) rows.set(row._id, row);
    }
    return { deleted: await deleteResultRows(ctx, [...rows.values()]) };
  },
});

/**
 * An event may lose at most this share of its stored results (and always
 * this many) in one prune without `allowShrink`: a corrected name or a
 * withdrawn result is a row or two, not a fifth of a meet.
 */
const RESULT_PRUNE_LIMIT = { share: 0.1, min: 5 };

/**
 * Rows one prune call deletes at most: each deletion rewrites its athlete's
 * history, as a batch of upserts does (`INGEST_BATCH` in the Sport80 sync),
 * so a retitled meet is pruned over several calls.
 */
export const RESULT_PRUNE_BATCH = 200;

/**
 * After a complete payload of an event's results was upserted: deletes the
 * event's stored rows that payload no longer has (a name Sport80 corrected,
 * a result withdrawn, rows under the meet's old title), through the same
 * path as every result write, so histories, summaries, views and search
 * follow. `keep` is the payload's rows, matched on the upsert's identity
 * (`resultKey`: meet, folded name, age category; `age` is required, so a
 * caller cannot leave it out and have every row with one deleted). A row
 * whose athlete is still in the payload under another meet title or age
 * category was only retitled; the rest count against RESULT_PRUNE_LIMIT,
 * past which nothing is deleted unless `allowShrink`. Deletes at most
 * RESULT_PRUNE_BATCH rows, dropped ones first (so a later call's guard sees
 * no larger share), and returns how many stale rows remain for the next call.
 */
export const pruneEventResults = internalMutation({
  args: {
    eventId: v.string(),
    keep: v.array(v.object({ meet: v.string(), name: v.string(), age: v.union(v.string(), v.null()) })),
    allowShrink: v.optional(v.boolean()),
  },
  handler: async (ctx, { eventId, keep, allowShrink }) => {
    if (!eventId) throw new Error('eventId is required');
    if (keep.length === 0) throw new Error(`refusing to prune event ${eventId}'s results against an empty payload`);
    const kept = new Set(keep.map(resultKey));
    const names = new Set(keep.map((row) => normalizeName(row.name)));
    // Only rows the Sport80 sync writes (USAW, not adaptive): an imported
    // row of another source under the same event id is not its to delete.
    const stored = (
      await ctx.db
        .query('lifting_results')
        .withIndex('by_event_and_name', (q) => q.eq('eventId', eventId))
        .collect()
    ).filter((row) => row.federation === 'USAW' && !row.adaptive);
    const stale = stored.filter((row) => !kept.has(resultKey(row)));
    const dropped = stale.filter((row) => !names.has(normalizeName(row.name)));
    const retitled = stale.filter((row) => names.has(normalizeName(row.name)));
    // Judged against the event's rows less the retitled copies, which are
    // its athletes counted twice.
    if (!allowShrink && exceedsShrink(dropped.length, stored.length - retitled.length, RESULT_PRUNE_LIMIT)) {
      throw new Error(
        `refusing to delete ${dropped.length} of event ${eventId}'s ${stored.length - retitled.length} stored results no longer in its Sport80 table ` +
          `(${dropped.slice(0, 10).map((row) => row.name).join(', ')}${dropped.length > 10 ? ', …' : ''}). ` +
          `If Sport80 really dropped them: npx convex run scrapers/sport80:run '{"only":["${eventId}"],"allowShrink":true}' (add --prod for production)`,
      );
    }
    const deleted = await deleteResultRows(ctx, [...dropped, ...retitled].slice(0, RESULT_PRUNE_BATCH));
    return { deleted, remaining: stale.length - deleted };
  },
});

/**
 * An empty start list or schedule is a failed load, not a meet without
 * one: refused unless the caller says it means to clear it.
 */
function refuseEmptyReplace(what: string, meet: string, rows: readonly unknown[], allowEmpty: boolean | undefined): void {
  if (rows.length === 0 && !allowEmpty) {
    throw new Error(`refusing to replace ${meet}'s ${what} with an empty payload; pass '{"allowEmpty":true}' to clear it`);
  }
}

/**
 * Replaces a meet's start list (by hand, from a published start list). Gender
 * is stored normalized, as the entries sync stores and matches it
 * (`upsertEntryAthletes`). An empty list is refused unless `allowEmpty`.
 */
export const replaceMeetAthletes = internalMutation({
  args: { meet: v.string(), rows: v.array(v.object(athletesFields)), allowEmpty: v.optional(v.boolean()) },
  handler: async (ctx, { meet, rows, allowEmpty }) => {
    if (rows.some((row) => row.meet !== meet)) throw new Error('every row must belong to `meet`');
    refuseEmptyReplace('start list', meet, rows, allowEmpty);
    const existing = await ctx.db
      .query('athletes')
      .withIndex('by_meet', (q) => q.eq('meet', meet))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);
    for (const row of rows) await ctx.db.insert('athletes', { ...row, gender: normalizeGender(row.gender) });
    await recordWrite(ctx, 'athletes', [
      { kind: 'meet', key: meet },
      { kind: 'table', key: 'athletes' },
    ]);
    return { deleted: existing.length, inserted: rows.length };
  },
});

/**
 * Replaces a meet's session schedule (by hand). Its values are stored as
 * given: nothing in a schedule row has a normalized spelling. An empty
 * schedule is refused unless `allowEmpty`.
 */
export const replaceMeetSchedule = internalMutation({
  args: { meet: v.string(), rows: v.array(v.object(sessionScheduleFields)), allowEmpty: v.optional(v.boolean()) },
  handler: async (ctx, { meet, rows, allowEmpty }) => {
    if (rows.some((row) => row.meet !== meet)) throw new Error('every row must belong to `meet`');
    refuseEmptyReplace('schedule', meet, rows, allowEmpty);
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

/** A stored meet's federation; rows from before the column was filled are USAW's. */
const meetFederation = (meet: Pick<Doc<'meets'>, 'federation'>) => normalizeFederation(meet.federation ?? 'USAW');

/**
 * The stored meet a federation's meet called `name` is: the one of that
 * federation under the name, or under the name `disambiguatedMeetName` gave
 * it. `taken`: another federation's meet holds the plain name, so a new meet
 * must take the disambiguated one. Meets are matched by exact name through
 * the index; the oldest wins if older rows repeat a name.
 */
async function meetOfFederation(
  ctx: MutationCtx,
  name: string,
  federation: string,
): Promise<{ match: Doc<'meets'> | null; taken: boolean }> {
  const candidates: Doc<'meets'>[] = [];
  for (const candidate of new Set([name, disambiguatedMeetName(name, federation)])) {
    candidates.push(
      ...(await ctx.db
        .query('meets')
        .withIndex('by_name', (q) => q.eq('name', candidate))
        .collect()),
    );
  }
  const own = candidates.filter((meet) => meetFederation(meet) === federation);
  const taken = candidates.some((meet) => meet.name === name && meetFederation(meet) !== federation);
  return { match: oldestMeet(own), taken };
}

/**
 * Inserts or updates meets (`upsert_meet`), matched on name and federation:
 * a sync never takes over another federation's meet of the same name. A new
 * meet whose name another federation's meet has is stored under
 * `disambiguatedMeetName` (and reported in `storedAs`), since the name is
 * the meet's identity everywhere; stored names never change. Only the
 * scraped columns are written, and the status follows the dates
 * (`meetStatusAt`): a completed meet whose dates move into the future is
 * upcoming again. Fields the scrapers do not own (venue map links) are kept.
 * A meet whose scraped values are unchanged is not written; `updatedAt`
 * moves only with a real change, so the nightly syncs do not invalidate
 * every meet's views.
 */
export const upsertMeets = internalMutation({
  args: { rows: v.array(scrapedMeet) },
  handler: async (ctx, { rows }): Promise<UpsertOutcome[]> => {
    const outcomes: UpsertOutcome[] = [];
    const hints: WriteHint[] = [];
    const now = Date.now();
    const formatters: ZoneFormatters = new Map();
    for (const row of rows) {
      const federation = normalizeFederation(row.federation ?? 'USAW');
      const { match: existing, taken } = await meetOfFederation(ctx, row.name, federation);
      const name = existing?.name ?? (taken ? disambiguatedMeetName(row.name, federation) : row.name);
      const values = { ...row, name, federation, status: meetStatusAt(row, now, formatters) };
      if (!existing) {
        await ctx.db.insert('meets', { ...values, updatedAt: now });
        if (taken) console.warn(`upsertMeets: another federation's meet is named ${JSON.stringify(row.name)}; stored this ${federation} meet as ${JSON.stringify(name)}`);
        outcomes.push({ wasInsert: true, wasChanged: true, ...(name !== row.name ? { storedAs: name } : {}) });
        hints.push({ kind: 'meet', key: name });
        continue;
      }
      const changed = (Object.keys(values) as (keyof typeof values)[]).some((key) => existing[key] !== values[key]);
      if (changed) {
        await ctx.db.patch(existing._id, { ...values, updatedAt: now });
        hints.push({ kind: 'meet', key: name });
      }
      outcomes.push({ wasInsert: false, wasChanged: changed, ...(name !== row.name ? { storedAs: name } : {}) });
    }
    if (hints.length) await recordWrite(ctx, 'meets', hints);
    return outcomes;
  },
});

const PLACEHOLDERS = new Set(['', 'TBD', 'Unknown']);

/**
 * USA Masters events from usamasters.net, upserted. An event is matched to
 * the USAMW meet stored under its name, whatever that meet's dates (it may
 * have been postponed, or stored with wrong ones): by exact name (or the
 * name `disambiguatedMeetName` gave it) through the index, or with case and
 * spacing folded among the meets not ended before the payload's first
 * event. The site's names often differ from the stored ones ("2027 National
 * Masters" vs "2027 USA Masters Nationals"), so failing that, to the one
 * unclaimed USAMW meet whose dates overlap. Several overlapping meets is
 * ambiguous and reported, not guessed. A new event is inserted, under
 * `disambiguatedMeetName` if another federation's meet has its name. A
 * match takes every value the site gives (dates, venue, city, state, time
 * zone), and its status follows the new dates (`meetStatusAt`); fields the
 * site leaves blank keep what is stored, and a move to another city clears
 * the old venue's street and zip. The stored name is kept: athletes and
 * results refer to a meet by name.
 */
export const syncUsamwEvents = internalMutation({
  args: { events: v.array(v.object({ name: v.string(), startDate: v.string(), endDate: v.string(), venueName: v.string(), venueCity: v.string(), venueState: v.string(), timeZone: v.string() })) },
  handler: async (ctx, { events }) => {
    const now = Date.now();
    const formatters: ZoneFormatters = new Map();
    const hints: WriteHint[] = [];
    const result = { inserted: [] as string[], updated: [] as string[], unchanged: [] as string[], ambiguous: [] as string[], renamed: [] as string[] };
    // Every USAMW meet that has not ended before the earliest event: the
    // candidates for a folded-name or date match.
    const earliest = events.reduce((min, e) => (e.startDate < min ? e.startDate : min), '9999-12-31');
    const usamw = (
      await ctx.db
        .query('meets')
        .withIndex('by_end_date', (q) => q.gte('endDate', earliest))
        .collect()
    ).filter((meet) => meetFederation(meet) === 'USAMW');
    // A meet stored under the event's own name is that event, whatever its
    // dates; those are claimed first, so a date match never takes another
    // event's meet.
    const byName = new Map<number, Doc<'meets'>>();
    const claimed = new Set<string>();
    const taken = new Map<number, boolean>();
    for (const [i, event] of events.entries()) {
      const exact = await meetOfFederation(ctx, event.name, 'USAMW');
      taken.set(i, exact.taken);
      const named = [exact.match, ...usamw.filter((meet) => normalizeName(meet.name) === normalizeName(event.name))].find(
        (meet): meet is Doc<'meets'> => meet !== null && !claimed.has(meet._id),
      );
      if (named) {
        byName.set(i, named);
        claimed.add(named._id);
      }
    }
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
        const name = taken.get(i) ? disambiguatedMeetName(event.name, 'USAMW') : event.name;
        await ctx.db.insert('meets', {
          ...event,
          name,
          venueStreet: 'TBD',
          venueZip: 'TBD',
          status: meetStatusAt(event, now, formatters),
          federation: 'USAMW',
          updatedAt: now,
        });
        hints.push({ kind: 'meet', key: name });
        result.inserted.push(name);
        if (name !== event.name) result.renamed.push(name);
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
      site.status = meetStatusAt({ ...match, ...site }, now, formatters);
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

/** Whether a start list has placed the athlete in a session. */
const hasSession = (athlete: Pick<Doc<'athletes'>, 'sessionNumber' | 'sessionPlatform'>) =>
  athlete.sessionNumber !== undefined || (athlete.sessionPlatform ?? '').trim() !== '';

/**
 * One meet's Sport80 entries (`upsert_athlete(..., preserve_assigned_session=True)`).
 * An athlete with a membership number is the row with that number and name
 * (names compared case- and space-insensitively) at the meet; one without is
 * the row with the same name and gender carrying a blank or placeholder id,
 * or an older row with a one-off nine-digit id and the same age (ids the old
 * scraper minted per run: a real membership number recurs at other meets).
 * Rows already given a session are left alone, and once any athlete of the
 * meet has a session (its start list is published) no entry is added: an
 * entrant the start list left out (scratched, withdrawn) stays out, so
 * entries never undo a published start list. Entries are not deleted when
 * they leave the list.
 */
export const upsertEntryAthletes = internalMutation({
  args: { meet: v.string(), rows: v.array(entryRow) },
  handler: async (ctx, { meet, rows }) => {
    if (rows.some((row) => row.meet !== meet)) throw new Error('every row must belong to `meet`');
    const existing = await ctx.db
      .query('athletes')
      .withIndex('by_meet', (q) => q.eq('meet', meet))
      .collect();
    const published = existing.some(hasSession);
    const counts = { inserted: 0, updated: 0, unchanged: 0, sessionSkipped: 0, notOnStartList: 0 };
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
        const sameName = existing.filter((a) => normalizeName(a.name) === nameKey && normalizeGender(a.gender) === gender);
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
      if (!match && published) {
        counts.notOnStartList += 1;
        continue;
      }
      if (!match) {
        const doc = { ...values, meet, adaptive: false };
        existing.push({ ...doc, _id: await ctx.db.insert('athletes', doc), _creationTime: Date.now() });
        counts.inserted += 1;
        continue;
      }
      if (hasSession(match)) {
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

/**
 * Moves each meet's status to what its dates say on the meet's own calendar
 * (`meetStatusAt`): `ongoing` from its first day, `completed` once its end
 * date has passed (`complete_ended_meets.sql` in the Rust backend), and back
 * to `upcoming` if its dates were moved into the future by hand. A meet
 * ending tonight in Los Angeles is not completed at 17:00 Pacific just
 * because the UTC date rolled over. Run hourly by `convex/crons.ts` (the
 * `complete-ended-meets` job); writes only when a meet actually changes,
 * through `recordWrite` like every other write. Returns how many changed.
 */
export const updateMeetStatuses = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const formatters: ZoneFormatters = new Map();
    const hints: WriteHint[] = [];
    // Every meet not completed, and every meet that may not have ended yet
    // anywhere (a completed one whose dates were moved).
    const meets = new Map<string, Doc<'meets'>>();
    for (const status of ['upcoming', 'ongoing'] as const) {
      for (const meet of await ctx.db
        .query('meets')
        .withIndex('by_status', (q) => q.eq('status', status))
        .collect()) {
        meets.set(meet._id, meet);
      }
    }
    for (const meet of await ctx.db
      .query('meets')
      .withIndex('by_end_date', (q) => q.gte('endDate', earliestLocalDate(now)))
      .collect()) {
      meets.set(meet._id, meet);
    }
    const counts: Record<MeetStatus, number> = { upcoming: 0, ongoing: 0, completed: 0 };
    for (const meet of meets.values()) {
      const status = meetStatusAt(meet, now, formatters);
      if (status === meet.status) continue;
      await ctx.db.patch(meet._id, { status, updatedAt: now });
      hints.push({ kind: 'meet', key: meet.name });
      counts[status] += 1;
    }
    if (hints.length > 0) await recordWrite(ctx, 'meets', hints);
    console.log(`Meet statuses: ${counts.completed} completed, ${counts.ongoing} ongoing, ${counts.upcoming} upcoming again.`);
    return hints.length;
  },
});

/**
 * Per-row outcome of an upsert, as the Python writers reported it.
 * `storedAs`: the name a meet is stored under when it is not the one sent
 * (`upsertMeets`).
 */
export type UpsertOutcome = { wasInsert: boolean; wasChanged: boolean; storedAs?: string };

/**
 * An index lookup run for every spelling a stored row of `gender` may still
 * hold (`storedGenderSpellings`), canonical first: until the gender
 * migrations have run, a row stored as `Male` is the `Men` row. The writers
 * below rewrite such a row's gender when they match it.
 */
async function bySpellingOf<T>(gender: string, read: (spelling: string) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = [];
  for (const spelling of storedGenderSpellings(gender)) rows.push(...(await read(spelling)));
  return rows;
}

/** A stored, possibly absent, gender compared as `normalizeGender` writes it. */
const storedGender = (gender: string | undefined) => (gender === undefined ? null : normalizeGender(gender));

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
        await bySpellingOf(doc.gender, (gender) =>
          ctx.db
            .query('standards')
            .withIndex('by_age_gender', (q) => q.eq('ageCategory', doc.ageCategory).eq('gender', gender))
            .collect(),
        )
      ).find((s) => s.weightClass === doc.weightClass);
      if (!existing) {
        await ctx.db.insert('standards', doc);
        outcomes.push({ wasInsert: true, wasChanged: true });
      } else if (existing.standardA !== doc.standardA || existing.standardB !== doc.standardB || existing.gender !== doc.gender) {
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
 * the Python writer's `None` did. Never deletes. Without `allowShrink`, a
 * payload that clears more of the matched records' stored lifts than
 * `exceedsShrink` allows is refused (nothing written): a lift row the parser
 * stopped finding reads as no record for every class at once.
 */
export const upsertRecords = internalMutation({
  args: { rows: v.array(recordRow), allowShrink: v.optional(v.boolean()) },
  handler: async (ctx, { rows, allowShrink }): Promise<UpsertOutcome[]> => {
    const pairs = [];
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
        await bySpellingOf(doc.gender, (gender) =>
          ctx.db
            .query('records')
            .withIndex('by_type_age_gender', (q) => q.eq('recordType', doc.recordType).eq('ageCategory', doc.ageCategory).eq('gender', gender))
            .collect(),
        )
      ).find((r) => r.weightClass === doc.weightClass);
      pairs.push({ doc, existing });
    }
    if (!allowShrink) {
      const matched = pairs.filter((pair) => pair.existing !== undefined);
      const storedLifts = matched.reduce((sum, { existing }) => sum + liftCount(existing!), 0);
      const cleared = matched.reduce((sum, { doc, existing }) => sum + clearedLifts(existing!, doc), 0);
      if (exceedsShrink(cleared, storedLifts)) {
        throw new Error(
          `refusing to clear ${cleared} of ${storedLifts} stored record lifts (the source may be partly broken). ` +
            `If it really cleared them, rerun its sync with '{"allowShrink":true}'`,
        );
      }
    }
    const outcomes: UpsertOutcome[] = [];
    for (const { doc, existing } of pairs) {
      if (!existing) {
        await ctx.db.insert('records', doc);
        outcomes.push({ wasInsert: true, wasChanged: true });
      } else if (liftsChanged(existing, doc) || existing.gender !== doc.gender) {
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
 * The exact-set syncs match stored rows to the payload by key. Rows stored
 * twice under one key (older loads allowed it) would leave all but one copy
 * out of the match, never updated or deleted, so the extra copies are deleted
 * here; `deleted` counts them.
 */
async function onePerKey<T extends { _id: Id<TableNames> }>(
  ctx: MutationCtx,
  rows: readonly T[],
  keyOf: (row: T) => string,
): Promise<{ byKey: Map<string, T>; deleted: number }> {
  const byKey = new Map<string, T>();
  let deleted = 0;
  for (const row of rows) {
    const key = keyOf(row);
    if (!byKey.has(key)) {
      byKey.set(key, row);
      continue;
    }
    await ctx.db.delete(row._id);
    deleted += 1;
  }
  return { byKey, deleted };
}

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
    const keyOf = (r: { ageCategory: string; gender: string; weightClass: string }) => JSON.stringify([r.ageCategory, normalizeGender(r.gender), r.weightClass]);
    const { byKey: existing, deleted: duplicates } = await onePerKey(
      ctx,
      await ctx.db.query('records').withIndex('by_record_type', (q) => q.eq('recordType', recordType)).collect(),
      keyOf,
    );
    const counts = { inserted: 0, updated: 0, deleted: duplicates, unchanged: 0 };
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
      } else if (liftsChanged(current, doc) || current.gender !== doc.gender) {
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

const qualifyingTotalRow = v.object({
  ageCategory: v.string(),
  gender: v.string(),
  weightClass: v.string(),
  qualifyingTotal: v.number(),
});

/**
 * Exact-set sync of one event's qualifying totals, the way `replaceRecordSet`
 * syncs a record type: gender and age normalized, classes missing from the
 * payload deleted, the rest written only where they changed. An empty
 * payload or a duplicate class is refused (a failed load, not an event
 * without totals). The only writer of `qualifying_totals`:
 *
 *   npx convex run ingest:replaceQualifyingTotalSet '{"eventName":"…","rows":[…]}'
 */
export const replaceQualifyingTotalSet = internalMutation({
  args: { eventName: v.string(), rows: v.array(qualifyingTotalRow) },
  handler: async (ctx, { eventName, rows }) => {
    if (!eventName.trim()) throw new Error('eventName is required');
    if (!rows.length) throw new Error(`refusing to replace ${eventName} qualifying totals with an empty payload`);
    const keyOf = (r: { ageCategory: string; gender: string; weightClass: string }) =>
      JSON.stringify([normalizeAgeCategory(r.ageCategory), normalizeGender(r.gender), r.weightClass]);
    const { byKey: existing, deleted: duplicates } = await onePerKey(
      ctx,
      await ctx.db
        .query('qualifying_totals')
        .withIndex('by_event', (q) => q.eq('eventName', eventName))
        .collect(),
      keyOf,
    );
    const counts = { inserted: 0, updated: 0, deleted: duplicates, unchanged: 0 };
    const seen = new Set<string>();
    for (const row of rows) {
      const doc = {
        eventName,
        ageCategory: normalizeAgeCategory(row.ageCategory),
        gender: normalizeGender(row.gender),
        weightClass: row.weightClass,
        qualifyingTotal: row.qualifyingTotal,
      };
      const key = keyOf(doc);
      if (seen.has(key)) throw new Error(`Duplicate ${eventName} qualifying total in payload: ${key}`);
      seen.add(key);
      const current = existing.get(key);
      if (!current) {
        await ctx.db.insert('qualifying_totals', doc);
        counts.inserted += 1;
      } else if (current.qualifyingTotal !== doc.qualifyingTotal || current.gender !== doc.gender || current.ageCategory !== doc.ageCategory) {
        await ctx.db.replace(current._id, doc);
        counts.updated += 1;
      } else counts.unchanged += 1;
    }
    for (const [key, row] of existing) {
      if (seen.has(key)) continue;
      await ctx.db.delete(row._id);
      counts.deleted += 1;
    }
    if (counts.inserted + counts.updated + counts.deleted > 0) {
      await recordWrite(ctx, 'qualifying_totals', [{ kind: 'table', key: 'qualifying_totals' }]);
    }
    return counts;
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
      await bySpellingOf(gender, (spelling) =>
        ctx.db
          .query('intl_rankings')
          .withIndex('by_gender_age', (q) => q.eq('gender', spelling).eq('ageCategory', ageCategory))
          .collect(),
      )
    ).filter((row) => row.meet === meet);
    const keyOf = (ranking: number | undefined, name: string | undefined) => JSON.stringify([ranking, name]);
    const incoming = new Set<string>();
    const writes: { id: (typeof existing)[number]['_id'] | null; doc: Omit<(typeof existing)[number], '_id' | '_creationTime'> }[] = [];
    // Checked before any write: a duplicate key in the payload aborts cleanly.
    for (const row of args.rankings) {
      const key = keyOf(row.ranking, row.name);
      if (incoming.has(key)) throw new Error(`Duplicate intl ranking in payload: ${meet}/${gender}/${ageCategory}/${row.ranking}/${row.name}`);
      incoming.add(key);
    }
    const { byKey: existingByKey, deleted: duplicates } = await onePerKey(ctx, existing, (row) => keyOf(row.ranking, row.name));
    const counts: SyncCounts = { inserted: 0, updated: 0, unchanged: 0, deleted: 0 };
    for (const row of args.rankings) {
      const key = keyOf(row.ranking, row.name);
      const doc = { meet, ranking: row.ranking, name: row.name, weightClass: row.weightClass, total: row.total, percentA: row.percentA, gender, ageCategory };
      const current = existingByKey.get(key);
      if (!current) {
        counts.inserted += 1;
        writes.push({ id: null, doc });
      } else if (
        current.legacyId !== undefined ||
        current.gender !== doc.gender ||
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
    counts.deleted = deletions.length + duplicates;
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
 * At most this share of the stored groups (and always this many) may be
 * pruned in one run without `allowShrink`. The standings page lists a few
 * dozen groups, so the WSO limits (20 classes) would never apply here.
 */
const INTL_GROUP_PRUNE_LIMIT = { share: 0.25, min: 2 };

/**
 * Deletes every international rankings group not in `groups` (the ones the
 * page still links), `delete_missing_intl_ranking_groups` in the Python
 * writer. An empty list deletes nothing. Without `allowShrink`, more than
 * INTL_GROUP_PRUNE_LIMIT of the stored groups is refused (nothing deleted):
 * groups vanish from the page when its cards change wording, not only when
 * they retire.
 */
export const deleteMissingIntlRankingGroups = internalMutation({
  args: { groups: v.array(v.object({ meet: v.string(), gender: v.string(), ageCategory: v.string() })), allowShrink: v.optional(v.boolean()) },
  handler: async (ctx, { groups, allowShrink }) => {
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
      const key = JSON.stringify([row.meet ?? null, storedGender(row.gender), row.ageCategory ?? null]);
      if (active.has(key)) continue;
      const group = byGroup.get(key) ?? { meet: row.meet ?? '', gender: row.gender ?? '', ageCategory: row.ageCategory ?? '', ids: [] };
      group.ids.push(row._id);
      byGroup.set(key, group);
    }
    const storedGroups = new Set(rows.map((row) => JSON.stringify([row.meet ?? null, storedGender(row.gender), row.ageCategory ?? null]))).size;
    if (!allowShrink && exceedsShrink(byGroup.size, storedGroups, INTL_GROUP_PRUNE_LIMIT)) {
      throw new Error(
        `refusing to prune ${byGroup.size} of ${storedGroups} international rankings groups no longer on the standings page ` +
          `(${[...byGroup.values()].map((g) => `${g.meet}/${g.gender}/${g.ageCategory}`).join(', ')}). ` +
          `If the page really retired them: npx convex run scrapers/intlRankings:run '{"allowShrink":true}' (add --prod for production)`,
      );
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
 *
 * Without `allowShrink`, a sync may delete only so many classes, and clear
 * only so many stored lifts, (`exceedsShrink`). More looks like a source
 * that partly broke, not one that changed its classes: refused, so the run
 * fails and alerts instead of deleting records.
 */
export const replaceWsoRecordSet = internalMutation({
  args: { wso: v.string(), rows: v.array(wsoRecordRow), allowShrink: v.optional(v.boolean()) },
  handler: async (ctx, { wso, rows, allowShrink }) => {
    if (!wso) throw new Error('wso is required');
    if (!rows.length) throw new Error(`refusing to replace ${wso} WSO records with an empty payload`);
    const keyOf = (r: { ageCategory: string; gender: string; weightClass: string }) => JSON.stringify([r.ageCategory, normalizeGender(r.gender), r.weightClass]);
    if (!allowShrink) {
      const incoming = new Map(rows.map((row) => [keyOf({ ageCategory: normalizeAgeCategory(row.ageCategory), gender: normalizeGender(row.gender), weightClass: row.weightClass }), row]));
      const stored = new Map((await ctx.db.query('wso_records').withIndex('by_wso', (q) => q.eq('wso', wso)).collect()).map((row) => [keyOf(row), row]));
      const dropped = [...stored.keys()].filter((key) => !incoming.has(key)).length;
      // A lift going from a value to none is a deletion too: a cell the
      // parser misread must not empty a WSO's records one lift at a time.
      const storedLifts = [...stored.values()].reduce((sum, row) => sum + liftCount(row), 0);
      const cleared = [...stored].reduce((sum, [key, row]) => sum + (incoming.has(key) ? clearedLifts(row, incoming.get(key)!) : 0), 0);
      const rerun = `npx convex run scrapers/wsoRecords:run '{"only":["${wso}"],"allowShrink":true}' (add --prod for production)`;
      if (exceedsShrink(dropped, stored.size)) {
        throw new Error(`refusing to delete ${dropped} of ${wso}'s ${stored.size} WSO record classes (the source may be partly broken). If it really dropped them: ${rerun}`);
      }
      if (exceedsShrink(cleared, storedLifts)) {
        throw new Error(`refusing to clear ${cleared} of ${wso}'s ${storedLifts} stored WSO record lifts (the source may be partly broken). If it really cleared them: ${rerun}`);
      }
    }
    const { byKey: existing, deleted: duplicates } = await onePerKey(
      ctx,
      await ctx.db.query('wso_records').withIndex('by_wso', (q) => q.eq('wso', wso)).collect(),
      keyOf,
    );
    const counts = { inserted: 0, updated: 0, deleted: duplicates, unchanged: 0 };
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
      } else if (liftsChanged(current, doc) || current.gender !== doc.gender) {
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

