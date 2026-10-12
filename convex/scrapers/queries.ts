import { v } from 'convex/values';
import { internalQuery, type QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { meetByName, oldestMeet } from '../lib/meetData';
import { normalizeName } from '../lib/names';
import { normalizeFederation } from '../lib/normalize';
import { canonicalMeetDate, isMeetTimeZone } from '../lib/validation';
import { oneClockCountryZone, usTerritoryTimeZone } from './lib/countries';
import { usTimeZone } from './lib/states';

const isUsaw = (meet: Doc<'meets'>) => normalizeFederation(meet.federation ?? 'USAW') === 'USAW';

/** The stored USAW meet Sport80 knows by `sourceId` (its event id; the oldest, if rows repeat one), or null. */
async function sport80Meet(ctx: QueryCtx, sourceId: string): Promise<Doc<'meets'> | null> {
  const rows = await ctx.db
    .query('meets')
    .withIndex('by_source_id', (q) => q.eq('sourceId', sourceId))
    .collect();
  return oldestMeet(rows.filter(isUsaw));
}

/**
 * What the meet sync reads before it writes (scrapers read state through
 * these), for the whole listing of Sport80's upcoming events:
 *
 * - `stored`: for each row, the stored meet it is, by event id (`bySource`)
 *   or else by name, with its status; null for a meet not stored.
 * - `unlisted`: stored upcoming USAW meets starting after `today` whose
 *   event id the listing no longer has: Sport80 deleted or cancelled the
 *   event, or it lost the id.
 */
export const meetsForSync = internalQuery({
  args: { rows: v.array(v.object({ name: v.string(), sourceId: v.union(v.string(), v.null()) })), today: v.string() },
  handler: async (ctx, { rows, today }) => {
    const stored = [];
    for (const row of rows) {
      const bySource = row.sourceId ? await sport80Meet(ctx, row.sourceId) : null;
      const meet = bySource ?? (await meetByName(ctx, row.name));
      stored.push(meet ? { name: meet.name, status: meet.status, bySource: bySource !== null } : null);
    }
    const listed = new Set(rows.map((row) => row.sourceId));
    const unlisted = (
      await ctx.db
        .query('meets')
        .withIndex('by_status', (q) => q.eq('status', 'upcoming'))
        .collect()
    )
      .filter((meet) => meet.sourceId !== undefined && !listed.has(meet.sourceId) && isUsaw(meet) && meet.startDate > today)
      .map((meet) => ({ name: meet.name, sourceId: meet.sourceId!, startDate: meet.startDate }));
    return { stored, unlisted };
  },
});

/**
 * The stored meet a Sport80 entries list is for: the meet Sport80 knows by
 * the list's event id, else the meet named by the list's title (unless
 * Sport80 knows that meet by another id), with its status and end date; null
 * when neither is stored.
 */
export const entriesMeet = internalQuery({
  args: { sourceId: v.string(), title: v.string() },
  handler: async (ctx, { sourceId, title }) => {
    const byName = async () => {
      const meet = await meetByName(ctx, title);
      return meet && (meet.sourceId === undefined || meet.sourceId === sourceId) ? meet : null;
    };
    const meet = (await sport80Meet(ctx, sourceId)) ?? (await byName());
    return meet ? { name: meet.name, status: meet.status, endDate: meet.endDate } : null;
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
