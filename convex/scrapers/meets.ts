'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchJson, withRetries } from './lib/http';
import { listedMeetTitle, readAllWidgetPages, transformMeets, widgetPageUrl, type ScrapedMeet, type TransformedMeets } from './parse/meets';
import { sourcesFailed, type SourceFailure } from '../lib/cronAlerts';
import type { ZoneFormatters } from '../lib/meetData';
import { meetStatusAt } from '../lib/meetStatus';

/**
 * Upcoming USAW meets (port of meet-sync: `sync-meets.js`,
 * `sync-nat-meets.js`, `sync-virus-meets.js`): the whole listing of Sport80's
 * public events widget, read once, and of it the meets MeetCal lists
 * (`listedMeetTitle`: WSO, national and Virus series meets) and every meet
 * stored under its Sport80 event id, whatever its title now. Each meet's
 * venue, dates and time zone are upserted, matched on the event id, then on
 * name (`ingest.upsertMeets`), so a meet Sport80 retitles stays one meet
 * under its stored name (#252, #413). A meet already completed is skipped, as
 * the WSO search did before, unless its scraped dates have moved into the
 * future: `upsertMeets` then takes the new dates and venue but keeps it
 * completed (`nextMeetStatus`, `lib/meetStatus.ts`).
 */
const fetchWidgetPage = (url: string): Promise<unknown> =>
  withRetries(() => fetchJson(url, { timeoutMs: 30_000 }), { attempts: 3, delayMs: (attempt) => 2 ** attempt * 1000 });

/** The failing source for the listing itself: stable from run to run, as the problem text is not. */
const LISTING = 'widget';

/**
 * Why a new meet was stored under `storedAs`: its name is another meet's
 * (usually another federation's), and rosters and results still refer to meets by
 * name, so those written under the plain name attach to the other meet
 * until a person renames one of the two.
 */
export function renamedMeetMessage(name: string, storedAs: string): string {
  return `another meet is named ${JSON.stringify(name)}, so this one was stored as ${JSON.stringify(storedAs)}; results and entries sent under the plain name still attach to the other meet (rename one by hand)`;
}

/**
 * Why a run reports a retitled meet: the meet, its schedule, roster and saved
 * sessions stay under the stored name, and the entries sync writes there too,
 * but Sport80's results come under the event's results title.
 */
export function retitledMeetMessage(from: string, to: string, storedAs: string): string {
  return `Sport80 retitled ${JSON.stringify(from)} to ${JSON.stringify(to)}; the meet is kept as ${JSON.stringify(storedAs)}, and its entries follow it. Results Sport80 publishes under the new title are stored under that title`;
}

/** Why a run reports a stored meet the listing lost: Sport80 deleted or cancelled the event. */
export function unlistedMeetMessage(sourceId: string, startDate: string): string {
  return `Sport80 no longer lists event ${sourceId} (starting ${startDate}): check whether it was cancelled, and remove the meet by hand if so`;
}

type SyncResult = Omit<TransformedMeets, 'meets'> & {
  fetched: number;
  /** Listed meets, and stored ones by event id, of the listing. */
  meets: ScrapedMeet[];
  skippedCompleted: string[];
  inserted: string[];
  updated: number;
  /** Stored upcoming meets whose event the listing no longer has. */
  unlisted: string[];
  error?: string;
};

export const run = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }): Promise<SyncResult> => {
    const result: SyncResult = { fetched: 0, meets: [], rejected: [], undated: [], unknownZone: [], skippedCompleted: [], inserted: [], updated: 0, unlisted: [] };
    let rows;
    try {
      rows = await readAllWidgetPages((page) => fetchWidgetPage(widgetPageUrl('', page)));
    } catch (error) {
      result.error = (error as Error).message;
      console.error(`meets: fetch failed: ${result.error}`);
      throw sourcesFailed('meets', [{ source: LISTING, error: result.error }]);
    }
    result.fetched = rows.length;
    const today = new Date().toISOString().slice(0, 10);
    const { stored, unlisted }: {
      stored: ({ name: string; status: string; bySource: boolean } | null)[];
      unlisted: { name: string; sourceId: string; startDate: string }[];
    } = await ctx.runQuery(internal.scrapers.queries.meetsForSync, { rows: rows.map((row) => ({ name: row.name, sourceId: row.id })), today });
    const statusOf = new Map<string, string>();
    const picked = rows.filter((row, i) => {
      const meet = stored[i];
      if (meet) statusOf.set(row.name, meet.status);
      return listedMeetTitle(row.name) || meet?.bySource === true;
    });
    Object.assign(result, transformMeets(picked));
    for (const problem of result.rejected) console.error(`meets: not synced: ${problem}`);
    if (result.undated.length) console.log(`meets: dates not set yet, not synced: ${result.undated.join('; ')}`);
    // Synced without a zone: a new meet gets a blank one, a stored one keeps its own.
    for (const problem of result.unknownZone) console.warn(`meets: no time zone for ${problem}`);
    const failed: SourceFailure[] = result.rejected.map((problem) => ({ source: LISTING, error: problem }));
    for (const meet of unlisted) {
      result.unlisted.push(meet.name);
      failed.push({ source: `meet ${meet.name}`, error: unlistedMeetMessage(meet.sourceId, meet.startDate) });
    }
    if (!dryRun && result.meets.length > 0) {
      const now = Date.now();
      const formatters: ZoneFormatters = new Map();
      const skipped = (m: ScrapedMeet) => statusOf.get(m.name) === 'completed' && meetStatusAt(m, now, formatters) === 'completed';
      result.skippedCompleted = result.meets.filter(skipped).map((m) => m.name);
      const toIngest = result.meets.filter((m) => !skipped(m));
      const outcomes: { wasInsert: boolean; wasChanged: boolean; storedAs?: string; retitledFrom?: string }[] = await ctx.runMutation(internal.ingest.upsertMeets, {
        rows: toIngest,
      });
      result.inserted = toIngest.filter((_, i) => outcomes[i].wasInsert).map((m) => m.name);
      // Stored, then the run fails once so a person hears: a new meet stored
      // under another name because another federation's meet has its name,
      // and a meet Sport80 retitled.
      toIngest.forEach((m, i) => {
        const { wasInsert, storedAs, retitledFrom } = outcomes[i];
        if (wasInsert && storedAs) failed.push({ source: `meet ${m.name}`, error: renamedMeetMessage(m.name, storedAs) });
        if (retitledFrom !== undefined) failed.push({ source: `meet ${storedAs ?? m.name}`, error: retitledMeetMessage(retitledFrom, m.name, storedAs ?? m.name) });
      });
      result.updated = outcomes.filter((o) => !o.wasInsert && o.wasChanged).length;
      console.log(`meets: ${result.fetched} listed, ${toIngest.length} synced, ${result.inserted.length} new, ${result.updated} updated`);
    }
    if (failed.length && !dryRun) throw sourcesFailed('meets', failed);
    return result;
  },
});
