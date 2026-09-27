'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { postSlack } from './lib/slack';
import { MEET_SEARCHES, transformMeets, type ScrapedMeet } from './parse/meets';

/**
 * Upcoming USAW meets (port of meet-sync: `sync-meets.js`,
 * `sync-nat-meets.js`, `sync-virus-meets.js`): three searches of Sport80's
 * public events widget, each meet's venue, dates and time zone upserted by
 * name. The WSO search skips meets already completed, as before; a meet
 * marked completed is never reopened either way.
 */
async function fetchWidget(url: string): Promise<{ name: string; address: string; subtitle: string }[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const body = (await response.json()) as { data?: { name: string; address: string; subtitle: string }[] };
      return body.data ?? [];
    } catch (error) {
      if (attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
    }
  }
}

type SearchResult = { key: string; fetched: number; meets: ScrapedMeet[]; skippedCompleted: string[]; inserted: string[]; updated: number; error?: string };

export const run = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }): Promise<SearchResult[]> => {
    const results: SearchResult[] = [];
    for (const search of MEET_SEARCHES) {
      const result: SearchResult = { key: search.key, fetched: 0, meets: [], skippedCompleted: [], inserted: [], updated: 0 };
      results.push(result);
      try {
        const rows = await fetchWidget(search.url);
        result.fetched = rows.length;
        result.meets = transformMeets(rows);
      } catch (error) {
        result.error = (error as Error).message;
        console.error(`meets (${search.key}): fetch failed: ${result.error}`);
        continue;
      }
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
      if (result.inserted.length) {
        await postSlack(
          process.env.SLACK_MEET_WEBHOOK_URL,
          `meets ${search.key}`,
          `${result.inserted.length} ${search.label} meets inserted\n\nMeets inserted:\n${result.inserted.map((n) => `- ${n}`).join('\n')}`,
        );
      }
    }
    const failed = results.filter((r) => r.error);
    if (failed.length) throw new Error(`meets: ${failed.map((r) => `${r.key}: ${r.error}`).join('; ')}`);
    return results;
  },
});
