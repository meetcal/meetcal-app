import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';

/**
 * The Sport80 entries pages the entries cron reads (the backend's
 * `entries_targets.json`).
 *
 *   npx convex run scrapers/entryTargets:add '{"label": "2026 Georgia WSO Championships", "url": "https://usaweightlifting.sport80.com/public/events/15004/entries/21879"}'
 *   npx convex run scrapers/entryTargets:remove '{"url": "..."}'
 */
export const list = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query('entry_targets').collect()).map(({ label, url }) => ({ label, url })),
});

export const add = internalMutation({
  args: { label: v.string(), url: v.string() },
  handler: async (ctx, { label, url }) => {
    const existing = await ctx.db
      .query('entry_targets')
      .withIndex('by_url', (q) => q.eq('url', url))
      .first();
    if (existing) await ctx.db.patch(existing._id, { label });
    else await ctx.db.insert('entry_targets', { label, url });
  },
});

export const remove = internalMutation({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    const existing = await ctx.db
      .query('entry_targets')
      .withIndex('by_url', (q) => q.eq('url', url))
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return existing !== null;
  },
});
