import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { normalizeName } from '../lib/names';

/** Current status of each named meet that exists (scrapers read state through these). */
export const meetStatuses = internalQuery({
  args: { names: v.array(v.string()) },
  handler: async (ctx, { names }) => {
    const statuses: Record<string, string> = {};
    for (const name of new Set(names)) {
      const meet = await ctx.db
        .query('meets')
        .withIndex('by_name', (q) => q.eq('name', name))
        .first();
      if (meet) statuses[name] = meet.status;
    }
    return statuses;
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
