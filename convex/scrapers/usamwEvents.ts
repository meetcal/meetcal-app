'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchPageText } from './lib/incompleteChain';
import { EVENTS_URL, parseUsamwEvents, type UsamwEvent } from './parse/usamwEvents';
import { sourcesFailed, type SourceFailure } from '../lib/cronAlerts';
import { renamedMeetMessage } from './meets';

/**
 * USA Masters events (replaces `usamw/meets/scrape_events.py`): the events
 * on usamasters.net, upserted into `meets` as USAMW meets.
 */
type RunResult = {
  events: UsamwEvent[];
  inserted: string[];
  updated: string[];
  unchanged: string[];
  ambiguous: string[];
  renamed: string[];
  ambiguousEvents: { event: string; meets: string[] }[];
  renamedEvents: { event: string; storedAs: string }[];
};
type SyncResult = Omit<RunResult, 'events'>;

/**
 * What needs a person after a sync, one failure per problem under a source
 * name that stays the same from run to run (`event <name>` for an event that
 * overlaps several stored meets, `meet <name>` for a new event stored under
 * another name), so a problem that turns up while the job is already failing
 * is a new failed source and emails (`afterRun`). The sync names each
 * problem's event, so meet names never decide the source.
 */
export function usamwEventFailures(result: Pick<SyncResult, 'ambiguousEvents' | 'renamedEvents'>): SourceFailure[] {
  return [
    ...result.ambiguousEvents.map(({ event, meets }) => ({
      source: `event ${event}`,
      error: `matches more than one meet, not updated: ${event}: ${meets.join(' / ')}`,
    })),
    ...result.renamedEvents.map(({ event, storedAs }) => ({ source: `meet ${event}`, error: renamedMeetMessage(event, storedAs) })),
  ];
}

export const run = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }): Promise<RunResult> => {
    const events = parseUsamwEvents(await fetchPageText(EVENTS_URL, 45_000));
    if (events.length === 0) throw new Error('usamw events: parsed 0 events');
    // Synced without a zone: a stored meet keeps its own, a new one gets a blank one.
    for (const event of events) if (event.timeZone === undefined) console.warn(`usamw events: no time zone for ${event.name} (${event.venueCity}, ${event.venueState})`);
    if (dryRun) return { events, inserted: [], updated: [], unchanged: [], ambiguous: [], renamed: [], ambiguousEvents: [], renamedEvents: [] };
    const result: SyncResult = await ctx.runMutation(internal.ingest.syncUsamwEvents, { events });
    // An event overlapping several stored meets, or a new one stored under
    // another name (another meet has its own), needs a person:
    // fail the run (the rest is stored) so the alert names it.
    const failures = usamwEventFailures(result);
    if (failures.length) throw sourcesFailed('usamw events', failures);
    return { events, ...result };
  },
});
