'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { MEET_SEARCHES, readAllWidgetPages, transformMeets, widgetPageUrl, type ScrapedMeet } from './parse/meets';

/**
 * Upcoming USAW meets (port of meet-sync: `sync-meets.js`,
 * `sync-nat-meets.js`, `sync-virus-meets.js`): three searches of Sport80's
 * public events widget, each meet's venue, dates and time zone upserted by
 * name. The WSO search skips meets already completed, as before; a meet
 * marked completed is never reopened either way.
 */
async function fetchWidgetPage(url: string): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`status ${response.status}`);
      return (await response.json()) as unknown;
    } catch (error) {
      if (attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
    }
  }
}

type SearchResult = {
  key: string;
  fetched: number;
  meets: ScrapedMeet[];
  rejected: string[];
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
    for (const search of MEET_SEARCHES) {
      const result: SearchResult = { key: search.key, fetched: 0, meets: [], rejected: [], unknownZone: [], skippedCompleted: [], inserted: [], updated: 0 };
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
      // Synced without a zone: a new meet gets a blank one, a stored one keeps its own.
      for (const problem of result.unknownZone) console.warn(`meets (${search.key}): no time zone for ${problem}`);
      if (dryRun || result.meets.length === 0) continue;
      let toIngest = result.meets;
      if (search.skipCompleted) {
        const statuses: Record<string, string> = await ctx.runQuery(internal.scrapers.queries.meetStatuses, {
          names: result.meets.map((m) => m.name),
        });
        result.skippedCompleted = result.meets.filter((m) => statuses[m.name] === 'completed').map((m) => m.name);
        toIngest = result.meets.filter((m) => statuses[m.name] !== 'completed');
      }
      const outcomes: { wasInsert: boolean; wasChanged: boolean }[] = await ctx.runMutation(internal.ingest.upsertMeets, { rows: toIngest });
      result.inserted = toIngest.filter((_, i) => outcomes[i].wasInsert).map((m) => m.name);
      result.updated = outcomes.filter((o) => !o.wasInsert && o.wasChanged).length;
      console.log(`meets (${search.key}): ${result.fetched} fetched, ${toIngest.length} synced, ${result.inserted.length} new, ${result.updated} updated`);
    }
    // A meet left out for unreadable dates fails the run (after the rest are
    // stored) so the alert names it.
    const failed = results.flatMap((r) => (r.error ? [`${r.key}: ${r.error}`] : r.rejected.map((problem) => `${r.key}: ${problem}`)));
    if (failed.length) throw new Error(`meets: ${failed.join('; ')}`);
    return results;
  },
});
