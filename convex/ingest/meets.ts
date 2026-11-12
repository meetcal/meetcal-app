import { changedFields, typedKeys } from '../lib/json';
import { MEETS_MAX, MEET_RESULTS_MAX, MEET_RESULT_TITLES_MAX, readAll } from '../lib/boundedRead';
import { v, type Infer } from 'convex/values';
import { internalMutation, type MutationCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { normalizeFederation } from '../lib/normalize';
import { disambiguatedMeetName, MAX_DISAMBIGUATED_NAMES, oldestMeet, type ZoneFormatters } from '../lib/meetData';
import { meetStatusAt, nextMeetStatus, type MeetStatus } from '../lib/meetStatus';
import { normalizeName } from '../lib/names';
import { isMeetTimeZone } from '../lib/validation';
import { type WriteHint, recordWrite } from './hints';
import { type UpsertOutcome } from './shared';

async function linkedMeetOfTitle(ctx: MutationCtx, title: string): Promise<string | null> {
  const link = await ctx.db
    .query('meet_result_titles')
    .withIndex('by_title', (q) => q.eq('title', title))
    .first();
  return link?.meet ?? null;
}

async function ownEventData(ctx: MutationCtx, meet: string): Promise<string[]> {
  const [roster, schedule, savedSessions] = await Promise.all([
    ctx.db
      .query('athletes')
      .withIndex('by_meet', (q) => q.eq('meet', meet))
      .first(),
    ctx.db
      .query('session_schedule')
      .withIndex('by_meet', (q) => q.eq('meet', meet))
      .first(),
    ctx.db
      .query('saved_sessions')
      .withIndex('by_meet', (q) => q.eq('meet', meet))
      .first(),
  ]);
  const found: [unknown, string][] = [
    [roster, 'a roster'],
    [schedule, 'a schedule'],
    [savedSessions, 'saved sessions'],
  ];
  return found.filter(([row]) => row !== null).map(([, label]) => label);
}

async function refuseUnlinkableTitle(ctx: MutationCtx, meet: string, title: string): Promise<void> {
  const other = (
    await readAll(
      ctx.db
        .query('meet_result_titles')
        .withIndex('by_title', (q) => q.eq('title', title)),
      MEET_RESULT_TITLES_MAX,
      'results titles linked to one meet',
    )
  ).find((link) => link.meet !== meet);
  if (other) throw new Error(`${JSON.stringify(title)} is already linked to ${JSON.stringify(other.meet)}`);
  const titleHasTitles = await ctx.db
    .query('meet_result_titles')
    .withIndex('by_meet', (q) => q.eq('meet', title))
    .first();
  if (titleHasTitles) throw new Error(`${JSON.stringify(title)} has results titles of its own; unlink them first`);
  if ((await ctx.db.query('meets').withIndex('by_name', (q) => q.eq('name', title)).first()) === null) return;
  const eventData = await ownEventData(ctx, title);
  if (eventData.length > 0) throw new Error(`${JSON.stringify(title)} is a meet of its own (${eventData.join(', ')}), not a results title`);
}

export const setMeetResultTitles = internalMutation({
  args: { meet: v.string(), titles: v.array(v.string()) },
  handler: async (ctx, { meet, titles }) => {
    const meetRow = await ctx.db
      .query('meets')
      .withIndex('by_name', (q) => q.eq('name', meet))
      .first();
    if (!meetRow) throw new Error(`no meet named ${JSON.stringify(meet)}`);
    const wanted = [...new Set(titles.map((title) => title.trim()))];
    if (wanted.some((title) => title === '' || title === meet)) throw new Error("a results title must be non-empty and not the meet's own name");
    const parent = wanted.length > 0 ? await linkedMeetOfTitle(ctx, meet) : null;
    if (parent !== null) throw new Error(`${JSON.stringify(meet)} is a results title of ${JSON.stringify(parent)}, so it cannot have results titles of its own`);
    for (const title of wanted) await refuseUnlinkableTitle(ctx, meet, title);
    const existing = await readAll(
      ctx.db
        .query('meet_result_titles')
        .withIndex('by_meet', (q) => q.eq('meet', meet)),
      MEET_RESULT_TITLES_MAX,
      'results titles linked to one meet',
    );
    for (const link of existing) await ctx.db.delete(link._id);
    for (const title of wanted) await ctx.db.insert('meet_result_titles', { meet, title });
    await recordWrite(ctx, 'lifting_results', [{ kind: 'meet', key: meet }]);
    return { meet, titles: wanted, results: await resultCounts(ctx, wanted) };
  },
});

/** Stored results under each title, for checking a link by its numbers. */
async function resultCounts(ctx: MutationCtx, titles: readonly string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const title of titles) {
    counts[title] = (
      await readAll(
        ctx.db
          .query('lifting_results')
          .withIndex('by_meet', (q) => q.eq('meet', title)),
        MEET_RESULTS_MAX,
        'results of one meet',
      )
    ).length;
  }
  return counts;
}

const scrapedMeet = v.object({
  name: v.string(),
  // The source's id for the event (the Sport80 event id), when it has one.
  sourceId: v.optional(v.string()),
  // Absent together when the scraper got no address: a stored meet keeps its
  // venue, a new one gets the meet's name and `NO_VENUE`.
  venueName: v.optional(v.string()),
  venueStreet: v.optional(v.string()),
  venueCity: v.optional(v.string()),
  venueState: v.optional(v.string()),
  venueZip: v.optional(v.string()),
  // Absent (or blank) when the scraper could not tell the zone: a stored
  // meet keeps its own, a new one is stored with a blank one.
  timeZone: v.optional(v.string()),
  startDate: v.string(),
  endDate: v.string(),
  status: v.union(v.literal('upcoming'), v.literal('ongoing'), v.literal('completed')),
  federation: v.optional(v.string()),
});

/** A meet stored without a known zone: every reader treats a blank zone as unknown. */
const UNKNOWN_TIME_ZONE = '';

/** The venue of a new meet scraped without an address (what `parseAddress('')` gave). */
const NO_VENUE = { venueStreet: '', venueCity: 'Unknown', venueState: 'Unknown', venueZip: 'Unknown' };

type ScrapedMeetRow = Infer<typeof scrapedMeet>;

/**
 * The scraped values a meet writes over the stored one (`existing`, null for
 * a new meet); `upsertMeets` adds its stored name and its status, which
 * follows the dates (`nextMeetStatus`). The time zone is left alone when the
 * scraper could not tell it (absent or blank), or when someone set it by hand
 * (`timeZoneLocked`, see `setMeetTimeZone`), so the nightly sync never undoes
 * a correction; a new meet with no zone is stored with a blank one. Likewise
 * the venue is left alone when the scraper got no address (`upsertMeets`
 * gives a new meet placeholders).
 */
export function scrapedMeetValues(row: ScrapedMeetRow, existing: Pick<Doc<'meets'>, 'timeZoneLocked'> | null) {
  const { timeZone, sourceId: _sourceId, ...rest } = row;
  const scrapedZone = timeZone?.trim() ? timeZone : undefined;
  const values: Omit<ScrapedMeetRow, 'timeZone' | 'sourceId'> & { federation: string; timeZone?: string } = {
    ...rest,
    federation: normalizeFederation(row.federation ?? 'USAW'),
  };
  if (!existing) values.timeZone = scrapedZone ?? UNKNOWN_TIME_ZONE;
  else if (scrapedZone !== undefined && !existing.timeZoneLocked) values.timeZone = scrapedZone;
  return values;
}

/** A stored meet's federation; rows from before the column was filled are USAW's. */
const meetFederation = (meet: Pick<Doc<'meets'>, 'federation'>) => normalizeFederation(meet.federation ?? 'USAW');

/**
 * The stored meet a federation's meet called `name` is: the one of that
 * federation stored under the name (and not one disambiguated from another
 * name), or one stored under a name `disambiguatedMeetName` gave it, which
 * keeps `name` as its `sourceName`. A meet the source itself calls
 * "Open (USAMW)" is a different event from a disambiguated "Open", so
 * neither is taken for the other. `taken`: another meet holds the plain
 * name, so a new meet must be stored as `freeName`, the first disambiguated
 * name no meet holds. Meets are matched by exact name through the index;
 * the oldest wins if older rows repeat a name.
 */
async function meetOfFederation(
  ctx: MutationCtx,
  name: string,
  federation: string,
): Promise<{ match: Doc<'meets'> | null; taken: boolean; freeName: string | null }> {
  const named = (candidate: string) =>
    readAll(
      ctx.db
        .query('meets')
        .withIndex('by_name', (q) => q.eq('name', candidate)),
      MEETS_MAX,
      'meets',
    );
  const plain = await named(name);
  const own = plain.filter((meet) => meetFederation(meet) === federation && (meet.sourceName ?? meet.name) === name);
  const taken = own.length === 0 && plain.length > 0;
  // Disambiguated names are taken in order, so the first free one ends the
  // search: no meet of `name` was stored under a later one.
  let freeName: string | null = null;
  for (let attempt = 1; attempt <= MAX_DISAMBIGUATED_NAMES && freeName === null; attempt++) {
    const candidate = disambiguatedMeetName(name, federation, attempt);
    const rows = await named(candidate);
    own.push(...rows.filter((meet) => meetFederation(meet) === federation && meet.sourceName === name));
    if (rows.length === 0) freeName = candidate;
  }
  return { match: oldestMeet(own), taken, freeName };
}

/**
 * The stored meet of a federation the source knows by `sourceId` (the
 * oldest, if older rows repeat one), or null.
 */
async function meetOfSource(ctx: MutationCtx, sourceId: string, federation: string): Promise<Doc<'meets'> | null> {
  const rows = await readAll(
    ctx.db
      .query('meets')
      .withIndex('by_source_id', (q) => q.eq('sourceId', sourceId)),
    MEETS_MAX,
    'meets',
  );
  return oldestMeet(rows.filter((meet) => meetFederation(meet) === federation));
}

/** The name a new meet called `name` is stored under: `freeName` when another meet holds `name`. */
function newMeetName(name: string, federation: string, { taken, freeName }: { taken: boolean; freeName: string | null }): string {
  if (!taken) return name;
  if (freeName === null) throw new Error(`no free name for the ${federation} meet ${JSON.stringify(name)}: ${MAX_DISAMBIGUATED_NAMES} disambiguated names are taken`);
  return freeName;
}

/**
 * Inserts or updates meets (`upsert_meet`), matched on the source's id for
 * the event (`sourceId`, the Sport80 event id), then on name and federation:
 * a sync never takes over another federation's meet of the same name, or one
 * the source knows by another id. A new meet whose name another meet has is
 * stored under a free `disambiguatedMeetName` (and reported in `storedAs`),
 * since the name is the meet's identity everywhere, and stored names never
 * change. So a meet the source retitles keeps its stored name, with the new
 * title in `sourceName`, and is reported in `retitled` on the write that sees
 * the new title. A meet matched by name takes the row's id, so its next
 * retitle is followed. Only the scraped columns are written
 * (`scrapedMeetValues`), and the status follows the dates (`meetStatusAt`, on
 * the zone the meet ends up with), except that a completed meet stays
 * completed (`nextMeetStatus`). Fields the scrapers do not own (venue map
 * links, a locked time zone) are kept. A meet whose scraped values are
 * unchanged is not written; `updatedAt` moves only with a real change, so the
 * nightly syncs do not invalidate every meet's views (taking an id is no such
 * change).
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
      const bySource = row.sourceId ? await meetOfSource(ctx, row.sourceId, federation) : null;
      const lookup = await meetOfFederation(ctx, row.name, federation);
      // A meet of this name the source knows by another id is another event
      // (one held again under an old title): never taken over.
      const otherEvent = lookup.match?.sourceId !== undefined && row.sourceId !== undefined && lookup.match.sourceId !== row.sourceId;
      const existing = bySource ?? (otherEvent ? null : lookup.match);
      const name = existing?.name ?? newMeetName(row.name, federation, otherEvent ? { ...lookup, taken: true } : lookup);
      const scraped = scrapedMeetValues(row, existing);
      // Read on the zone the meet ends up with, so a row without one is read
      // on the stored zone.
      const timeZone = scraped.timeZone ?? existing?.timeZone;
      const values = { ...scraped, name, status: nextMeetStatus(existing?.status, meetStatusAt({ ...row, timeZone }, now, formatters)) };
      if (!existing) {
        await ctx.db.insert('meets', {
          venueName: row.name,
          ...NO_VENUE,
          ...values,
          timeZone: values.timeZone ?? UNKNOWN_TIME_ZONE,
          ...(name !== row.name ? { sourceName: row.name } : {}),
          ...(row.sourceId ? { sourceId: row.sourceId } : {}),
          updatedAt: now,
        });
        if (name !== row.name) console.warn(`upsertMeets: another meet is named ${JSON.stringify(row.name)}; stored this ${federation} meet as ${JSON.stringify(name)}`);
        outcomes.push({ wasInsert: true, wasChanged: true, ...(name !== row.name ? { storedAs: name } : {}) });
        hints.push({ kind: 'meet', key: name });
        continue;
      }
      // What the source called the meet before, and calls it now when that
      // is not its stored name (a disambiguated name's plain one, or a new
      // title).
      const before = existing.sourceName ?? existing.name;
      const sourceName = row.name === name ? undefined : row.name;
      const changed = typedKeys(values).some((key) => existing[key] !== values[key]) || existing.sourceName !== sourceName;
      const sourceId = row.sourceId ? { sourceId: row.sourceId } : {};
      if (changed) {
        await ctx.db.patch(existing._id, { ...values, sourceName, ...sourceId, updatedAt: now });
        hints.push({ kind: 'meet', key: name });
      } else if (row.sourceId && existing.sourceId !== row.sourceId) {
        // Only the id is new: nothing a view shows changed.
        await ctx.db.patch(existing._id, sourceId);
      }
      if (row.name !== before) console.warn(`upsertMeets: the source retitled ${JSON.stringify(before)} to ${JSON.stringify(row.name)}; kept as ${JSON.stringify(name)}`);
      outcomes.push({
        wasInsert: false,
        wasChanged: changed,
        ...(name !== row.name ? { storedAs: name } : {}),
        ...(row.name !== before ? { retitledFrom: before } : {}),
      });
    }
    if (hints.length) await recordWrite(ctx, 'meets', hints);
    return outcomes;
  },
});

/**
 * Sets a meet's time zone by hand, locked by default so the meet syncs never
 * overwrite it (the state-based guess is wrong for a few places, see
 * `scrapers/lib/states.ts`): `npx convex run ingest:setMeetTimeZone
 * '{"name":"…","timeZone":"America/New_York"}'`. Pass `locked: false` to hand
 * the zone back to the syncs. Any IANA zone is accepted ("Asia/Tokyo",
 * "Europe/Madrid"): every client shows a meet's times in its own zone. Names
 * that are not IANA zones are refused (`isMeetTimeZone`). Goes through
 * `recordWrite` like every write, so the meet's views follow.
 */
export const setMeetTimeZone = internalMutation({
  args: { name: v.string(), timeZone: v.string(), locked: v.optional(v.boolean()) },
  handler: async (ctx, { name, timeZone, locked }) => {
    if (!isMeetTimeZone(timeZone)) {
      throw new Error(`not an IANA time zone: ${JSON.stringify(timeZone)} (spell it as the database does, e.g. "America/Chicago" or "Asia/Tokyo")`);
    }
    const meet = await ctx.db
      .query('meets')
      .withIndex('by_name', (q) => q.eq('name', name))
      .first();
    if (!meet) throw new Error(`no meet named ${JSON.stringify(name)}`);
    const timeZoneLocked = locked ?? true;
    if (meet.timeZone === timeZone && (meet.timeZoneLocked ?? false) === timeZoneLocked) return { changed: false };
    await ctx.db.patch(meet._id, { timeZone, timeZoneLocked, updatedAt: Date.now() });
    await recordWrite(ctx, 'meets', [{ kind: 'meet', key: name }]);
    return { changed: true };
  },
});

/**
 * Ties a stored meet to the source's id for its event (the Sport80 event
 * id, from its widget or entries URL), for a meet stored before ids were, or
 * that its source retitled before then: `npx convex run
 * ingest:setMeetSourceId '{"name":"…","sourceId":"14836"}'`. The meet sync
 * then follows its title, and the entries sync writes the event's entries
 * under the meet's stored name. Refused when another meet of the federation
 * holds the id.
 */
export const setMeetSourceId = internalMutation({
  args: { name: v.string(), sourceId: v.string() },
  handler: async (ctx, { name, sourceId }) => {
    if (!/^\d+$/.test(sourceId)) throw new Error(`not a Sport80 event id: ${JSON.stringify(sourceId)}`);
    const meet = oldestMeet(
      await readAll(
        ctx.db
          .query('meets')
          .withIndex('by_name', (q) => q.eq('name', name)),
        MEETS_MAX,
        'meets',
      ),
    );
    if (!meet) throw new Error(`no meet named ${JSON.stringify(name)}`);
    const holder = await meetOfSource(ctx, sourceId, meetFederation(meet));
    if (holder && holder._id !== meet._id) throw new Error(`event ${sourceId} is already the meet ${JSON.stringify(holder.name)}`);
    if (meet.sourceId === sourceId) return { changed: false };
    // No view shows the id: nothing to refresh.
    await ctx.db.patch(meet._id, { sourceId });
    return { changed: true };
  },
});

/**
 * Sets a meet's status by hand: `npx convex run ingest:setMeetStatus
 * '{"name":"…","status":"completed"}'`. A meet set to `completed` stays
 * completed whatever its dates say (`nextMeetStatus`). That covers a meet
 * finished early, and is the only way to reopen one: a meet auto-completed
 * from a wrong past date whose source has since fixed it. A meet set to
 * `upcoming` or `ongoing` goes on following its dates, so the hourly job
 * completes it after its last day. Goes through `recordWrite`, so the meet's
 * package, which carries its status, is rebuilt (a dashboard edit is not).
 */
export const setMeetStatus = internalMutation({
  args: { name: v.string(), status: v.union(v.literal('upcoming'), v.literal('ongoing'), v.literal('completed')) },
  handler: async (ctx, { name, status }) => {
    const meet = await ctx.db
      .query('meets')
      .withIndex('by_name', (q) => q.eq('name', name))
      .first();
    if (!meet) throw new Error(`no meet named ${JSON.stringify(name)}`);
    if (meet.status === status) return { changed: false };
    await ctx.db.patch(meet._id, { status, updatedAt: Date.now() });
    await recordWrite(ctx, 'meets', [{ kind: 'meet', key: name }]);
    return { changed: true };
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
 * a free `disambiguatedMeetName` if another meet has its name. A
 * match takes every value the site gives (dates, venue, city, state, time
 * zone), and its status follows the new dates unless it is completed
 * (`nextMeetStatus`); fields the
 * site leaves blank keep what is stored, and a move to another city clears
 * the old venue's street and zip. An event without a zone keeps the stored
 * one, unless it moved to another state (then the zone is blank: unknown);
 * a new one is stored with a blank zone. The stored name is kept: athletes and
 * results refer to a meet by name.
 */
export const syncUsamwEvents = internalMutation({
  // `timeZone` is absent (or blank) when the site's location names none: a
  // country with several zones (Canada, Mexico) or an unknown place.
  args: { events: v.array(v.object({ name: v.string(), startDate: v.string(), endDate: v.string(), venueName: v.string(), venueCity: v.string(), venueState: v.string(), timeZone: v.optional(v.string()) })) },
  handler: async (ctx, { events }) => {
    const now = Date.now();
    const formatters: ZoneFormatters = new Map();
    const hints: WriteHint[] = [];
    const result = {
      inserted: [] as string[],
      updated: [] as string[],
      unchanged: [] as string[],
      ambiguous: [] as string[],
      renamed: [] as string[],
      // The same problems by event name, for alerts that must name the event
      // whatever the meet names hold (`scrapers/usamwEvents.ts`).
      ambiguousEvents: [] as { event: string; meets: string[] }[],
      renamedEvents: [] as { event: string; storedAs: string }[],
    };
    // Every USAMW meet that has not ended before the earliest event: the
    // candidates for a folded-name or date match.
    const earliest = events.reduce((min, e) => (e.startDate < min ? e.startDate : min), '9999-12-31');
    const usamw = (
      await readAll(
        ctx.db
          .query('meets')
          .withIndex('by_end_date', (q) => q.gte('endDate', earliest)),
        MEETS_MAX,
        'meets',
      )
    ).filter((meet) => meetFederation(meet) === 'USAMW');
    // A meet stored under the event's own name is that event, whatever its
    // dates; those are claimed first, so a date match never takes another
    // event's meet.
    const byName = new Map<number, Doc<'meets'>>();
    const claimed = new Set<string>();
    const lookups = new Map<number, Awaited<ReturnType<typeof meetOfFederation>>>();
    for (const [i, event] of events.entries()) {
      const exact = await meetOfFederation(ctx, event.name, 'USAMW');
      lookups.set(i, exact);
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
          result.ambiguousEvents.push({ event: event.name, meets: overlapping.map((meet) => meet.name) });
          continue;
        }
        match = overlapping[0];
        if (match) claimed.add(match._id);
      }
      if (!match) {
        const name = newMeetName(event.name, 'USAMW', lookups.get(i)!);
        await ctx.db.insert('meets', {
          ...event,
          timeZone: event.timeZone?.trim() ? event.timeZone : UNKNOWN_TIME_ZONE,
          name,
          ...(name !== event.name ? { sourceName: event.name } : {}),
          venueStreet: 'TBD',
          venueZip: 'TBD',
          status: meetStatusAt(event, now, formatters),
          federation: 'USAMW',
          updatedAt: now,
        });
        hints.push({ kind: 'meet', key: name });
        result.inserted.push(name);
        if (name !== event.name) {
          result.renamed.push(name);
          result.renamedEvents.push({ event: event.name, storedAs: name });
        }
        continue;
      }
      const site: Partial<Doc<'meets'>> = { startDate: event.startDate, endDate: event.endDate };
      for (const field of ['venueName', 'venueCity', 'venueState'] as const) {
        if (!PLACEHOLDERS.has(event[field])) site[field] = event[field];
      }
      // A zone set by hand is kept. Otherwise the site's zone is taken; moved
      // to a place the site names no zone for, the old place's zone would be
      // wrong there, so it is unknown (blank). Same state, kept.
      if (site.venueState && !match.timeZoneLocked) {
        if (event.timeZone?.trim()) site.timeZone = event.timeZone;
        else if (site.venueState !== match.venueState) site.timeZone = UNKNOWN_TIME_ZONE;
      }
      if (site.venueCity && site.venueCity !== match.venueCity) {
        site.venueStreet = 'TBD';
        site.venueZip = 'TBD';
        site.venueName ??= 'TBD';
      }
      site.status = nextMeetStatus(match.status, meetStatusAt({ ...match, ...site }, now, formatters));
      const patch = changedFields(site, match);
      if (Object.keys(patch).length === 0) {
        result.unchanged.push(match.name);
        continue;
      }
      await ctx.db.patch(match._id, { ...patch, updatedAt: now });
      hints.push({ kind: 'meet', key: match.name });
      result.updated.push(`${match.name} (${typedKeys(patch).map((key) => `${key} ${match[key] ?? ''} -> ${patch[key]}`).join(', ')})`);
    }
    if (hints.length) await recordWrite(ctx, 'meets', hints);
    return result;
  },
});

/**
 * Moves each meet not yet completed to what its dates say on the meet's own
 * calendar (`meetStatusAt`): `ongoing` from its first day, `completed` once
 * its end date has passed (`complete_ended_meets.sql` in the Rust backend),
 * and back to `upcoming` if an ongoing meet's dates moved into the future.
 * A completed meet is never reopened (`nextMeetStatus`), so one marked
 * completed by hand before its dates stays completed. A meet
 * ending tonight in Los Angeles is not completed at 17:00 Pacific just
 * because the UTC date rolled over, and a meet with no zone is read on
 * UTC-12's calendar, so it is never ongoing or completed early. Run hourly by `convex/crons.ts` (the
 * `complete-ended-meets` job); writes only when a meet actually changes,
 * through `recordWrite` like every other write. Returns how many changed.
 */
export const updateMeetStatuses = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const formatters: ZoneFormatters = new Map();
    const hints: WriteHint[] = [];
    // Every meet not completed: a completed one stays completed.
    const meets: Doc<'meets'>[] = [];
    for (const status of ['upcoming', 'ongoing'] as const) {
      meets.push(
        ...(await readAll(
          ctx.db
            .query('meets')
            .withIndex('by_status_and_start_date', (q) => q.eq('status', status)),
          MEETS_MAX,
          'meets',
        )),
      );
    }
    const counts: Record<MeetStatus, number> = { upcoming: 0, ongoing: 0, completed: 0 };
    for (const meet of meets) {
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
