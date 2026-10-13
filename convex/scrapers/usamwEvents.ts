'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchText } from './lib/http';
import { EVENTS_URL, parseUsamwEvents, type UsamwEvent } from './parse/usamwEvents';
import { sourcesFailed, type SourceFailure } from '../lib/cronAlerts';
import { renamedMeetMessage } from './meets';

/**
 * USA Masters events (replaces `usamw/meets/scrape_events.py`): the events
 * on usamasters.net, upserted into `meets` as USAMW meets.
 */
type RunResult = { events: UsamwEvent[]; inserted: string[]; updated: string[]; unchanged: string[]; ambiguous: string[]; renamed: string[] };
type SyncResult = Omit<RunResult, 'events'>;

/** The event a sync message is about: the longest name it starts with followed by `separator`, so "Open" never claims "Open 2". */
function eventNamed(events: readonly UsamwEvent[], text: string, separator: string): string | undefined {
  return events
    .map((event) => event.name)
    .filter((name) => text.startsWith(`${name}${separator}`))
    .sort((a, b) => b.length - a.length)[0];
}

/**
 * What needs a person after a sync, one failure per problem under a source
 * name that stays the same from run to run (`event <name>` for an event that
 * overlaps several stored meets, `meet <name>` for a new event stored under
 * another name), so a problem that turns up while the job is already failing
 * is a new failed source and emails (`afterRun`).
 */
export function usamwEventFailures(events: readonly UsamwEvent[], result: Pick<SyncResult, 'ambiguous' | 'renamed'>): SourceFailure[] {
  const failures: SourceFailure[] = [];
  for (const entry of result.ambiguous) {
    // `syncUsamwEvents` writes "<event>: <meet> / <meet>".
    const name = eventNamed(events, entry, ': ');
    failures.push({ source: `event ${name ?? entry}`, error: `matches more than one meet, not updated: ${entry}` });
  }
  for (const storedAs of result.renamed) {
    // Stored as "<event> (USAMW)" or "<event> (USAMW 2)".
    const name = eventNamed(events, storedAs, ' (') ?? storedAs;
    failures.push({ source: `meet ${name}`, error: renamedMeetMessage(name, storedAs) });
  }
  return failures;
}

export const run = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }): Promise<RunResult> => {
    const events = parseUsamwEvents(await fetchText(EVENTS_URL, 45_000));
    if (events.length === 0) throw new Error('usamw events: parsed 0 events');
    // Synced without a zone: a stored meet keeps its own, a new one gets a blank one.
    for (const event of events) if (event.timeZone === undefined) console.warn(`usamw events: no time zone for ${event.name} (${event.venueCity}, ${event.venueState})`);
    if (dryRun) return { events, inserted: [], updated: [], unchanged: [], ambiguous: [], renamed: [] };
    const result: SyncResult = await ctx.runMutation(internal.ingest.syncUsamwEvents, { events });
    // An event overlapping several stored meets, or a new one stored under
    // another name (another meet has its own), needs a person:
    // fail the run (the rest is stored) so the alert names it.
    const failures = usamwEventFailures(events, result);
    if (failures.length) throw sourcesFailed('usamw events', failures);
    return { events, ...result };
  },
});
