import { v } from 'convex/values';
import { internalMutation, internalQuery, type ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { compareBytes } from '../lib/sort';
import { MEET_INDEX_VIEW, meetViewsPrefix } from '../lib/viewKeys';
import { deleteViewsWithPrefix, jsonChunks, readViewJsonAnyAge, writeView, viewKeysWithPrefix as keysWithPrefix } from '../lib/views';

// The meet index (`MEET_INDEX_VIEW`): every meet that has views, kept so a
// refresh never rediscovers it from the tables.
/** Distinct roster meets per `rosterMeetsPage` query, one index seek each. */
const ROSTER_MEETS_PER_PAGE = 500;

/**
 * The next roster meets after `after`: one read per meet (a skip along the
 * index), not one per roster row, since rosters are never deleted.
 */
export const rosterMeetsPage = internalQuery({
  args: { after: v.union(v.string(), v.null()) },
  handler: async (ctx, { after }): Promise<{ meets: string[]; after: string | null }> => {
    const meets: string[] = [];
    let last = after;
    for (let i = 0; i < ROSTER_MEETS_PER_PAGE; i += 1) {
      const lower = last;
      const athlete = await ctx.db
        .query('athletes')
        .withIndex('by_meet', (q) => (lower === null ? q : q.gt('meet', lower)))
        .first();
      if (!athlete) return { meets, after: null };
      meets.push(athlete.meet);
      last = athlete.meet;
    }
    return { meets, after: last };
  },
});

/** Every meet row's name, as JSON text (the list may pass Convex's array limit). */
export const meetRowNames = internalQuery({
  args: {},
  handler: async (ctx): Promise<string> => JSON.stringify((await ctx.db.query('meets').collect()).map((m) => m.name)),
});

/**
 * Every meet with a meet row or a roster, sorted, read from the tables.
 * Rosters can arrive before their meet row; their start lists still resolve.
 */
export async function discoverMeets(ctx: ActionCtx): Promise<string[]> {
  const names = new Set(JSON.parse(await ctx.runQuery(internal.views.meetRowNames, {})) as string[]);
  let after: string | null = null;
  do {
    const page: { meets: string[]; after: string | null } = await ctx.runQuery(internal.views.rosterMeetsPage, { after });
    for (const meet of page.meets) names.add(meet);
    after = page.after;
  } while (after !== null);
  return [...names].sort(compareBytes);
}

export const storeMeetIndex = internalMutation({
  args: { chunks: v.array(v.string()) },
  handler: async (ctx, { chunks }) => {
    await writeView(ctx, MEET_INDEX_VIEW, chunks, []);
  },
});

/** Adds and removes meets in the index; never creates it (a partial index would hide meets). */
export const patchMeetIndex = internalMutation({
  args: { add: v.array(v.string()), remove: v.array(v.string()) },
  handler: async (ctx, { add, remove }) => {
    const text = await readViewJsonAnyAge(ctx, MEET_INDEX_VIEW);
    if (text === null) return;
    const meets = new Set(JSON.parse(text) as string[]);
    for (const meet of add) meets.add(meet);
    for (const meet of remove) meets.delete(meet);
    await writeView(ctx, MEET_INDEX_VIEW, jsonChunks([...meets].sort(compareBytes)), []);
  },
});

/** The meet index, built from the tables the first time it is needed. */
export async function loadMeetIndex(ctx: ActionCtx): Promise<string[]> {
  const text: string | null = await ctx.runQuery(internal.views.jsonViewAnyAge, { key: MEET_INDEX_VIEW });
  if (text !== null) return JSON.parse(text) as string[];
  const meets = await discoverMeets(ctx);
  await ctx.runMutation(internal.views.storeMeetIndex, { chunks: jsonChunks(meets) });
  return meets;
}

/** Of `meets`, those with a meet row or a roster: the ones that have views. */
export const meetsWithViews = internalQuery({
  args: { meets: v.array(v.string()) },
  handler: async (ctx, { meets }) => {
    const found = await Promise.all(
      meets.map(async (meet) => {
        const row = await ctx.db
          .query('meets')
          .withIndex('by_name', (q) => q.eq('name', meet))
          .first();
        if (row) return meet;
        const athlete = await ctx.db
          .query('athletes')
          .withIndex('by_meet', (q) => q.eq('meet', meet))
          .first();
        return athlete ? meet : null;
      }),
    );
    return found.filter((meet): meet is string => meet !== null);
  },
});

/**
 * Deletes every view of these meets. For meets with results but no meet row
 * or roster: their views are not rebuilt, and one left behind would be served
 * as fresh once the meet's hint was gone, while its results changed.
 */
export const deleteMeetViews = internalMutation({
  args: { meets: v.array(v.string()) },
  handler: async (ctx, { meets }) => {
    let deleted = 0;
    for (const meet of meets) deleted += await deleteViewsWithPrefix(ctx, meetViewsPrefix(meet));
    return deleted;
  },
});

export const viewKeysWithPrefix = internalQuery({
  args: { prefix: v.string() },
  handler: async (ctx, { prefix }) => await keysWithPrefix(ctx, prefix),
});
