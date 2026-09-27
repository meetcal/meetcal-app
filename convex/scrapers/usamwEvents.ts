'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchText } from './lib/http';
import { postSlack } from './lib/slack';
import { EVENTS_URL, parseUsamwEvents, type UsamwEvent } from './parse/usamwEvents';

/**
 * USA Masters events (replaces `usamw/meets/scrape_events.py`): the events
 * on usamasters.net, synced into `meets` as USAMW meets. Slack posts when a
 * meet is added or changed.
 */
type RunResult = { events: UsamwEvent[]; inserted: string[]; updated: string[]; unchanged: string[]; locationDiffers: string[] };

export const run = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }): Promise<RunResult> => {
    const events = parseUsamwEvents(await fetchText(EVENTS_URL, 45_000));
    if (events.length === 0) throw new Error('usamw events: parsed 0 events');
    if (dryRun) return { events, inserted: [], updated: [], unchanged: [], locationDiffers: [] };
    const result: Omit<RunResult, 'events'> = await ctx.runMutation(internal.ingest.syncUsamwEvents, { events });
    for (const note of result.locationDiffers) console.log(`usamw events: location differs: ${note}`);
    if (result.inserted.length || result.updated.length) {
      const list = (title: string, items: string[]) => (items.length ? `\n\n*${title}*\n${items.map((item) => `• ${item}`).join('\n')}` : '');
      await postSlack(
        process.env.SLACK_MEET_WEBHOOK_URL,
        'usamw events',
        `*USAMW Events Update*${list('Added', result.inserted)}${list('Updated', result.updated)}`,
      );
    }
    return { events, ...result };
  },
});
