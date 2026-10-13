import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { meetByName } from '../lib/meetData';
import { normalizeName } from '../lib/names';
import { canonicalMeetDate, isMeetTimeZone } from '../lib/validation';
import { oneClockCountryZone, usTerritoryTimeZone } from './lib/countries';
import { usTimeZone } from './lib/states';

/** Current status of each named meet that exists (scrapers read state through these). */
export const meetStatuses = internalQuery({
  args: { names: v.array(v.string()) },
  handler: async (ctx, { names }) => {
    const statuses: Record<string, string> = {};
    for (const name of new Set(names)) {
      const meet = await meetByName(ctx, name);
      if (meet) statuses[name] = meet.status;
    }
    return statuses;
  },
});

/**
 * Stored meets the meet scrapers once got wrong, for a person to review
 * (read-only; `npx convex run scrapers/queries:meetDataProblems`):
 *
 * - `badDates`: a start or end date that is not a padded `YYYY-MM-DD`
 *   ("undefined-TBD-undefined", "2026-9-5"). `migrations:padMeetDates`
 *   pads the unpadded ones; fix (or delete) the others by hand, or let the
 *   next sync with real dates overwrite them.
 * - `unknownZone`: a blank time zone, or one that is not an IANA zone name
 *   (`isMeetTimeZone`). A meet abroad in a country with several zones is
 *   stored blank and listed here until someone sets its zone.
 * - `zoneDiffers`: an unlocked zone that differs from what the state and city,
 *   or the one-zone country, now give (a split state guessed per state
 *   before); the next sync of a meet still listed fixes it,
 *   `ingest:setMeetTimeZone` fixes any other.
 */
export const meetDataProblems = internalQuery({
  args: {},
  handler: async (ctx) => {
    const meets = await ctx.db.query('meets').collect();
    const badDates = [];
    const unknownZone = [];
    const zoneDiffers = [];
    for (const meet of meets) {
      const { name, status, startDate, endDate, timeZone, venueCity, venueState } = meet;
      if (canonicalMeetDate(startDate) !== startDate || canonicalMeetDate(endDate) !== endDate) {
        badDates.push({ name, status, startDate, endDate });
      }
      if (!isMeetTimeZone(timeZone)) {
        unknownZone.push({ name, status, timeZone, venueCity, venueState });
        continue;
      }
      // A country with outlying islands (Spain) is not judged: its zone
      // depends on the region, which a stored meet does not keep.
      const derived = usTimeZone(venueState, venueCity) ?? usTerritoryTimeZone(venueState) ?? oneClockCountryZone(venueState);
      if (!meet.timeZoneLocked && derived !== null && derived !== timeZone) {
        zoneDiffers.push({ name, status, timeZone, derived, venueCity, venueState });
      }
    }
    return { badDates, unknownZone, zoneDiffers };
  },
});

/** Meets per `truncatedEntryNames` page unless the caller asks for fewer. */
const TRUNCATED_NAMES_PAGE_SIZE = 20;

/**
 * Entry rows left by the old entries scraper, which cut each surname at its
 * first space: within one meet, an athlete whose folded name is a leading run
 * of whole words of another's ("maria de" / "maria de la cruz") with the same
 * membership number, or both without one. The next entries run repairs the
 * rows of meets still taking entries; these are the ones it did not reach.
 * Read-only, a page of meets at a time: pass back `cursor` until `isDone`.
 * A truncated row with no full-name twin cannot be told from a real name.
 */
export const truncatedEntryNames = internalQuery({
  args: { cursor: v.optional(v.union(v.string(), v.null())), numItems: v.optional(v.number()) },
  handler: async (ctx, { cursor, numItems }) => {
    const pageSize = Math.min(Math.max(1, Math.floor(numItems ?? TRUNCATED_NAMES_PAGE_SIZE)), TRUNCATED_NAMES_PAGE_SIZE);
    const page = await ctx.db.query('meets').paginate({ cursor: cursor ?? null, numItems: pageSize });
    const pairs = [];
    for (const meet of page.page) {
      const athletes = await ctx.db
        .query('athletes')
        .withIndex('by_meet', (q) => q.eq('meet', meet.name))
        .collect();
      const idless = (id: string) => id === '' || id.startsWith('noid:');
      const byKey = new Map<string, typeof athletes>();
      for (const athlete of athletes) {
        const key = normalizeName(athlete.name);
        byKey.set(key, [...(byKey.get(key) ?? []), athlete]);
      }
      for (const full of athletes) {
        const words = normalizeName(full.name).split(' ');
        // Every shorter leading run of the name's words, two words at least.
        for (let n = 2; n < words.length; n++) {
          for (const short of byKey.get(words.slice(0, n).join(' ')) ?? []) {
            if (short.memberId !== full.memberId && !(idless(short.memberId) && idless(full.memberId))) continue;
            pairs.push({ meet: meet.name, truncated: { id: short._id, name: short.name, memberId: short.memberId }, full: { id: full._id, name: full.name, memberId: full.memberId } });
          }
        }
      }
    }
    return { pairs, cursor: page.continueCursor, isDone: page.isDone };
  },
});

/** Status and end date (the meet's own calendar) of each named meet that exists. */
export const meetEnds = internalQuery({
  args: { names: v.array(v.string()) },
  handler: async (ctx, { names }) => {
    const ends: Record<string, { status: string; endDate: string }> = {};
    for (const name of new Set(names)) {
      const meet = await meetByName(ctx, name);
      if (meet) ends[name] = { status: meet.status, endDate: meet.endDate };
    }
    return ends;
  },
});

/**
 * Registrations naming a WSO read per member. Only start lists loaded by hand
 * carry WSOs, a few per member; past this many, the rest go unread.
 */
const MEMBER_WSO_READS = 50;

/**
 * Each member's WSO as their most recent registration that names one gives
 * it, for the entries sync to store with entrants (#345): Sport80's entries
 * list carries no WSO, start lists loaded by hand do. Most recent is by the
 * meet's start date, not when the row was stored (a start list reloaded
 * later is not newer); a registration whose meet has no stored date ranks
 * below dated ones, and equal dates go to the row stored last. Membership
 * numbers only (digits); a member with no registration naming a WSO is left
 * out. At most 500 ids a call.
 */
export const memberWsos = internalQuery({
  args: { memberIds: v.array(v.string()) },
  handler: async (ctx, { memberIds }): Promise<Record<string, string>> => {
    if (memberIds.length > 500) throw new Error('at most 500 memberIds per call');
    const ids = [...new Set(memberIds.filter((id) => /^\d+$/.test(id)))];
    const meetDates = new Map<string, Promise<string>>();
    const meetDate = (meet: string) => {
      if (!meetDates.has(meet)) meetDates.set(meet, meetByName(ctx, meet).then((row) => (row ? (canonicalMeetDate(row.startDate) ?? '') : '')));
      return meetDates.get(meet)!;
    };
    const found: Record<string, string> = {};
    for (let i = 0; i < ids.length; i += 250) {
      const batch = ids.slice(i, i + 250);
      const wsos = await Promise.all(
        batch.map(async (memberId) => {
          const rows = await ctx.db
            .query('athletes')
            .withIndex('by_memberId_and_wso', (q) => q.eq('memberId', memberId).gt('wso', ''))
            .take(MEMBER_WSO_READS);
          let best: { wso: string; date: string; created: number } | null = null;
          for (const row of rows) {
            const wso = (row.wso ?? '').trim();
            if (wso === '') continue;
            const date = await meetDate(row.meet);
            if (best === null || date > best.date || (date === best.date && row._creationTime > best.created)) best = { wso, date, created: row._creationTime };
          }
          return best?.wso ?? null;
        }),
      );
      batch.forEach((memberId, index) => {
        const wso = wsos[index];
        if (wso) found[memberId] = wso;
      });
    }
    return found;
  },
});
