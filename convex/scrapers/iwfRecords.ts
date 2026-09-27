'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { postSlack } from './lib/slack';
import { IWF_PAGES, parseIwfWikitext, wikitextUrl, type IwfAge, type IwfRecord } from './parse/iwfRecords';

/**
 * IWF world records (replaces `iwf/world-records/scraper.py`, blocked by
 * iwf.sport's Cloudflare challenge): senior, junior and youth records from
 * Wikipedia's lists (see `parse/iwfRecords.ts`), synced as the exact IWF set
 * like `replaceIWFRecords` did. Slack posts when a record changes.
 */

// Wikipedia's API policy asks clients to identify themselves.
const USER_AGENT = 'MeetCal/1.0 (https://github.com/meetcal/meetcal-app; IWF world records sync)';

async function wikitext(page: string): Promise<string> {
  const response = await fetch(wikitextUrl(page), { headers: { 'User-Agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Wikipedia ${page} failed with ${response.status}`);
  const body = (await response.json()) as { parse?: { wikitext?: string }; error?: { info?: string } };
  if (!body.parse?.wikitext) throw new Error(`Wikipedia ${page}: ${body.error?.info ?? 'no wikitext'}`);
  return body.parse.wikitext;
}

type RunResult = { records: IwfRecord[]; inserted: number; updated: number; deleted: number; unchanged: number; changes: string[] };

export const run = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }): Promise<RunResult> => {
    const records: IwfRecord[] = [];
    for (const [age, page] of Object.entries(IWF_PAGES) as [IwfAge, string][]) records.push(...parseIwfWikitext(await wikitext(page), age));
    if (dryRun) return { records, inserted: 0, updated: 0, deleted: 0, unchanged: 0, changes: [] };
    const result: Omit<RunResult, 'records'> = await ctx.runMutation(internal.ingest.replaceRecordSet, {
      recordType: 'IWF',
      rows: records.map((r) => ({ recordType: 'IWF', ...r })),
    });
    if (result.inserted + result.updated + result.deleted > 0) {
      const lines = result.changes.map((change) => `• ${change}`).join('\n');
      await postSlack(
        process.env.SLACK_IWF_RECORDS_WEBHOOK_URL ?? process.env.SLACK_RECORDS_WEBHOOK_URL,
        'iwf records',
        `*IWF World Records Update*\n\n${result.inserted} inserted, ${result.updated} updated, ${result.deleted} deleted${lines ? `\n\n${lines}` : ''}`,
      );
    }
    return { records, ...result };
  },
});
