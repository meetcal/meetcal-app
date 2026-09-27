import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';

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
