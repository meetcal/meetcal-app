'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchText } from './lib/http';
import { EVENTS_URL, parseUsamwEvents, type UsamwEvent } from './parse/usamwEvents';

/**
 * USA Masters events (replaces `usamw/meets/scrape_events.py`): the events
 * on usamasters.net, upserted into `meets` as USAMW meets.
 */
type RunResult = { events: UsamwEvent[]; inserted: string[]; updated: string[]; unchanged: string[] };

export const run = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }): Promise<RunResult> => {
    const events = parseUsamwEvents(await fetchText(EVENTS_URL, 45_000));
    if (events.length === 0) throw new Error('usamw events: parsed 0 events');
    if (dryRun) return { events, inserted: [], updated: [], unchanged: [] };
    const result: Omit<RunResult, 'events'> = await ctx.runMutation(internal.ingest.syncUsamwEvents, { events });
    return { events, ...result };
  },
});
