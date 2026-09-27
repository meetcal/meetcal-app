import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';

/** The last text seen on each watched page (urlwatch's cache.db). */
export const get = internalQuery({
  args: { url: v.string() },
  handler: async (ctx, { url }) =>
    await ctx.db
      .query('watched_pages')
      .withIndex('by_url', (q) => q.eq('url', url))
      .first(),
});

export const save = internalMutation({
  args: { url: v.string(), text: v.optional(v.string()), error: v.optional(v.string()) },
  handler: async (ctx, { url, text, error }) => {
    const existing = await ctx.db
      .query('watched_pages')
      .withIndex('by_url', (q) => q.eq('url', url))
      .first();
    const now = Date.now();
    if (!existing) {
      await ctx.db.insert('watched_pages', { url, text: text ?? '', error, checkedAt: now, changedAt: now });
      return;
    }
    const changed = text !== undefined && text !== existing.text;
    await ctx.db.patch(existing._id, { ...(text !== undefined ? { text } : {}), error, checkedAt: now, ...(changed ? { changedAt: now } : {}) });
  },
});
