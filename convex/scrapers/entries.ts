'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { postSlack } from './lib/slack';
import { entriesEndpoint, entryFromRow, meetFromTitle, type Entry, type EntryRow } from './parse/entries';

/**
 * Meet entries (replaces the `entries` job's `usaw/entry_scraper/csv_scraper.js`):
 * each target's entries list from Sport80's public entries endpoint, upserted
 * into `athletes`. Targets whose meet is already completed are skipped (the
 * list was pruned by hand before). Slack posts per meet when athletes were
 * added or changed.
 */
async function getJson(url: string): Promise<{ title?: string; total?: number; data?: EntryRow[] }> {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`);
  return (await response.json()) as { title?: string; total?: number; data?: EntryRow[] };
}

/** A target's meet name and every entry, all pages, checked against the list's total. */
export async function fetchEntries(pageUrl: string): Promise<{ meet: string; entries: Entry[] }> {
  const endpoint = entriesEndpoint(pageUrl);
  const table = await getJson(endpoint);
  if (!table.title) throw new Error(`no table title at ${endpoint}`);
  const meet = meetFromTitle(table.title);
  const rows: EntryRow[] = [];
  let total = Infinity;
  for (let page = 0; rows.length < total && page < 50; page++) {
    const data = await getJson(`${endpoint}?data=1&p=${page}&l=100&sort=&d=asc&s=`);
    total = data.total ?? 0;
    if (!data.data?.length) break;
    rows.push(...data.data);
  }
  const ids = new Set(rows.map((row) => row.id));
  if (rows.length !== total || ids.size !== rows.length) throw new Error(`${meet}: read ${rows.length} rows (${ids.size} distinct) of ${total}`);
  return { meet, entries: rows.map((row) => entryFromRow(row, meet)) };
}

type MeetResult = { label: string; meet?: string; entries?: number; inserted?: number; updated?: number; unchanged?: number; sessionSkipped?: number; skipped?: string; error?: string };

export const run = internalAction({
  args: { dryRun: v.optional(v.boolean()), only: v.optional(v.array(v.string())) },
  handler: async (ctx, { dryRun, only }): Promise<MeetResult[]> => {
    const targets = (await ctx.runQuery(internal.scrapers.entryTargets.list, {})).filter((t) => !only || only.includes(t.label) || only.includes(t.url));
    const results: MeetResult[] = [];
    for (const target of targets) {
      const result: MeetResult = { label: target.label };
      results.push(result);
      try {
        const { meet, entries } = await fetchEntries(target.url);
        Object.assign(result, { meet, entries: entries.length });
        const statuses: Record<string, string> = await ctx.runQuery(internal.scrapers.queries.meetStatuses, { names: [meet] });
        if (statuses[meet] === 'completed') {
          result.skipped = 'meet completed';
          continue;
        }
        if (dryRun || entries.length === 0) continue;
        const counts: { inserted: number; updated: number; unchanged: number; sessionSkipped: number } = await ctx.runMutation(internal.ingest.upsertEntryAthletes, { meet, rows: entries });
        Object.assign(result, counts);
        if (counts.inserted + counts.updated > 0) {
          await postSlack(
            process.env.SLACK_ENTRY_WEBHOOK_URL,
            `entries ${meet}`,
            `*Entries Update - ${meet}*\n\n• ${counts.inserted} inserted\n• ${counts.updated} updated\n• ${counts.unchanged} unchanged\n• ${counts.sessionSkipped} skipped (session already set)`,
          );
        }
      } catch (error) {
        result.error = (error as Error).message;
        console.error(`entries (${target.label}): ${result.error}`);
      }
    }
    const failed = results.filter((r) => r.error);
    if (failed.length && !dryRun) throw new Error(`entries: ${failed.map((r) => `${r.label}: ${r.error}`).join('; ')}`);
    return results;
  },
});
