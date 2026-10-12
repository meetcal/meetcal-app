'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchText } from './lib/http';
import { EVENTS_URL, parseUsamwEvents, type UsamwEvent } from './parse/usamwEvents';
import { sourcesFailed, type SourceFailure } from '../lib/cronAlerts';

/**
 * USA Masters events (replaces `usamw/meets/scrape_events.py`): the events
 * on usamasters.net, upserted into `meets` as USAMW meets.
 */
type RunResult = {
  events: UsamwEvent[];
  inserted: string[];
  updated: string[];
  unchanged: string[];
  ambiguous: { event: string; meets: string[] }[];
  renamed: { event: string; storedAs: string }[];
};

export const run = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }): Promise<RunResult> => {
    const events = parseUsamwEvents(await fetchText(EVENTS_URL, 45_000));
    if (events.length === 0) throw new Error('usamw events: parsed 0 events');
    // Synced without a zone: a stored meet keeps its own, a new one gets a blank one.
    for (const event of events) if (event.timeZone === undefined) console.warn(`usamw events: no time zone for ${event.name} (${event.venueCity}, ${event.venueState})`);
    if (dryRun) return { events, inserted: [], updated: [], unchanged: [], ambiguous: [], renamed: [] };
    const result: Omit<RunResult, 'events'> = await ctx.runMutation(internal.ingest.syncUsamwEvents, { events });
    // An event overlapping several stored meets, or a new one stored under
    // another name (another meet has its own), needs a person: fail the run
    // (the rest is stored) so the alert names it. One source per problem,
    // named by the site's event name (stable from run to run, as `meets.ts`
    // names a rename), so a problem that appears while the job is already
    // failing still emails.
    const problems: SourceFailure[] = [
      ...result.ambiguous.map(({ event, meets }) => ({ source: `event ${event}`, error: `matches more than one meet (${meets.join(' / ')}), not updated` })),
      ...result.renamed.map(({ event, storedAs }) => ({
        source: `meet ${event}`,
        error: `new event stored as ${JSON.stringify(storedAs)}: another meet has its name; results entered under the plain name attach to that meet`,
      })),
    ];
    if (problems.length) throw sourcesFailed('usamw events', problems);
    return { events, ...result };
  },
});
