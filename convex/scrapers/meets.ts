'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchJson, withRetries } from './lib/http';
import { MEET_SEARCHES, readAllWidgetPages, transformMeets, widgetPageUrl, type ScrapedMeet } from './parse/meets';
import { sourcesFailed, type SourceFailure } from '../lib/cronAlerts';
import type { ZoneFormatters } from '../lib/meetData';
import { meetStatusAt } from '../lib/meetStatus';

/**
 * Upcoming USAW meets (port of meet-sync: `sync-meets.js`,
 * `sync-nat-meets.js`, `sync-virus-meets.js`): three searches of Sport80's
 * public events widget, each meet's venue, dates and time zone upserted by
 * name. The WSO search skips meets already completed, as before, unless
 * their scraped dates have moved into the future: `upsertMeets` then makes
 * them upcoming again (status follows the dates, `lib/meetStatus.ts`).
 */
const fetchWidgetPage = (url: string): Promise<unknown> =>
  withRetries(() => fetchJson(url, { timeoutMs: 30_000 }), { attempts: 3, delayMs: (attempt) => 2 ** attempt * 1000 });

/**
 * Why a new meet was stored under `storedAs`: its name is another meet's
 * (usually another federation's), and rosters and results still refer to meets by
 * name, so those written under the plain name attach to the other meet
 * until a person renames one of the two.
 */
export function renamedMeetMessage(name: string, storedAs: string): string {
  return `another meet is named ${JSON.stringify(name)}, so this one was stored as ${JSON.stringify(storedAs)}; results and entries sent under the plain name still attach to the other meet (rename one by hand)`;
}

type SearchResult = {
  key: string;
  fetched: number;
  meets: ScrapedMeet[];
  rejected: string[];
  undated: string[];
  unknownZone: string[];
  skippedCompleted: string[];
  inserted: string[];
  updated: number;
  error?: string;
};

export const run = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }): Promise<SearchResult[]> => {
    const results: SearchResult[] = [];
    // New meets stored under another name because another federation's
    // meet has theirs: stored, then the run fails once so a person hears.
    const renamed: SourceFailure[] = [];
    for (const search of MEET_SEARCHES) {
      const result: SearchResult = { key: search.key, fetched: 0, meets: [], rejected: [], undated: [], unknownZone: [], skippedCompleted: [], inserted: [], updated: 0 };
      results.push(result);
      try {
        const rows = await readAllWidgetPages((page) => fetchWidgetPage(widgetPageUrl(search.search, page)));
        result.fetched = rows.length;
        Object.assign(result, transformMeets(rows));
      } catch (error) {
        result.error = (error as Error).message;
        console.error(`meets (${search.key}): fetch failed: ${result.error}`);
        continue;
      }
      for (const problem of result.rejected) console.error(`meets (${search.key}): not synced: ${problem}`);
      if (result.undated.length) console.log(`meets (${search.key}): dates not set yet, not synced: ${result.undated.join('; ')}`);
      // Synced without a zone: a new meet gets a blank one, a stored one keeps its own.
      for (const problem of result.unknownZone) console.warn(`meets (${search.key}): no time zone for ${problem}`);
      if (dryRun || result.meets.length === 0) continue;
      let toIngest = result.meets;
      if (search.skipCompleted) {
        const statuses: Record<string, string> = await ctx.runQuery(internal.scrapers.queries.meetStatuses, {
          names: result.meets.map((m) => m.name),
        });
        const now = Date.now();
        const formatters: ZoneFormatters = new Map();
        const skipped = (m: ScrapedMeet) => statuses[m.name] === 'completed' && meetStatusAt(m, now, formatters) === 'completed';
        result.skippedCompleted = result.meets.filter(skipped).map((m) => m.name);
        toIngest = result.meets.filter((m) => !skipped(m));
      }
      const outcomes: { wasInsert: boolean; wasChanged: boolean; storedAs?: string }[] = await ctx.runMutation(internal.ingest.upsertMeets, { rows: toIngest });
      result.inserted = toIngest.filter((_, i) => outcomes[i].wasInsert).map((m) => m.name);
      toIngest.forEach((m, i) => {
        const { wasInsert, storedAs } = outcomes[i];
        if (wasInsert && storedAs) renamed.push({ source: `meet ${m.name}`, error: renamedMeetMessage(m.name, storedAs) });
      });
      result.updated = outcomes.filter((o) => !o.wasInsert && o.wasChanged).length;
      console.log(`meets (${search.key}): ${result.fetched} fetched, ${toIngest.length} synced, ${result.inserted.length} new, ${result.updated} updated`);
    }
    // A meet left out for unreadable dates fails the run (after the rest are
    // stored) so the alert names it. The search is the failing source: its
    // key is stable from run to run, the problem text is not.
    const failed = results.flatMap((r) =>
      r.error ? [{ source: r.key, error: r.error }] : r.rejected.map((problem) => ({ source: r.key, error: problem })),
    );
    failed.push(...renamed);
    if (failed.length) throw sourcesFailed('meets', failed);
    return results;
  },
});
