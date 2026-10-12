import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { meetByName } from '../lib/meetData';

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
