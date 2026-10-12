'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchJson } from './lib/http';
import { entriesEndpoint, entryFromRow, meetFromTitle, type Entry, type EntryRow } from './parse/entries';
import { sourcesFailed } from '../lib/cronAlerts';

/**
 * Meet entries (replaces the `entries` job's `usaw/entry_scraper/csv_scraper.js`):
 * each target's entries list from Sport80's public entries endpoint, upserted
 * into `athletes`. A target's meet is read from the list's title before any
 * page of entries: a completed meet is skipped without downloading its list,
 * and its target is removed once the meet ended TARGET_RETENTION_DAYS ago
 * (the list was pruned by hand before), so the job's work stays bounded by
 * the meets still to come.
 */
async function getJson(url: string): Promise<{ title?: string; total?: number; data?: EntryRow[] }> {
  return (await fetchJson(url, { timeoutMs: 60_000 })) as { title?: string; total?: number; data?: EntryRow[] };
}

/** A target's meet name, from its entries table's title (one request). */
export async function fetchEntriesMeet(pageUrl: string): Promise<string> {
  const endpoint = entriesEndpoint(pageUrl);
  const table = await getJson(endpoint);
  if (!table.title) throw new Error(`no table title at ${endpoint}`);
  return meetFromTitle(table.title);
}

/** Every entry of a target's list, all pages, checked against the list's total. */
export async function fetchEntries(pageUrl: string, meet: string): Promise<Entry[]> {
  const endpoint = entriesEndpoint(pageUrl);
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
  return rows.map((row) => entryFromRow(row, meet));
}

/** Days a completed meet's target is kept (and skipped) after the meet ends, before it is removed. */
export const TARGET_RETENTION_DAYS = 14;

/**
 * Whether a completed meet that ended on `endDate` (its own calendar) ended
 * over `days` days before `now`. Compared with the UTC date: a day either
 * way is nothing against the retention. An end date that is not a
 * `YYYY-MM-DD` date never expires: the target stays, skipped.
 */
export function targetExpired(endDate: string, now: number, days = TARGET_RETENTION_DAYS): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return false;
  return endDate < new Date(now - days * 86_400_000).toISOString().slice(0, 10);
}

type MeetResult = {
  label: string;
  meet?: string;
  entries?: number;
  inserted?: number;
  updated?: number;
  unchanged?: number;
  sessionSkipped?: number;
  notOnStartList?: number;
  skipped?: string;
  error?: string;
};

export const run = internalAction({
  args: { dryRun: v.optional(v.boolean()), only: v.optional(v.array(v.string())) },
  handler: async (ctx, { dryRun, only }): Promise<MeetResult[]> => {
    const targets = (await ctx.runQuery(internal.scrapers.entryTargets.list, {})).filter((t) => !only || only.includes(t.label) || only.includes(t.url));
    const results: MeetResult[] = [];
    for (const target of targets) {
      const result: MeetResult = { label: target.label };
      results.push(result);
      try {
        const meet = await fetchEntriesMeet(target.url);
        result.meet = meet;
        const stored: Record<string, { status: string; endDate: string }> = await ctx.runQuery(internal.scrapers.queries.meetEnds, { names: [meet] });
        if (stored[meet]?.status === 'completed') {
          result.skipped = 'meet completed';
          if (!dryRun && targetExpired(stored[meet].endDate, Date.now())) {
            await ctx.runMutation(internal.scrapers.entryTargets.remove, { url: target.url });
            result.skipped = `meet completed ${stored[meet].endDate}, target removed`;
          }
          continue;
        }
        const entries = await fetchEntries(target.url, meet);
        result.entries = entries.length;
        if (dryRun || entries.length === 0) continue;
        const counts: { inserted: number; updated: number; unchanged: number; sessionSkipped: number; notOnStartList: number } = await ctx.runMutation(
          internal.ingest.upsertEntryAthletes,
          { meet, rows: entries },
        );
        Object.assign(result, counts);
      } catch (error) {
        result.error = (error as Error).message;
        console.error(`entries (${target.label}): ${result.error}`);
      }
    }
    const failed = results.filter((r) => r.error);
    if (failed.length && !dryRun) throw sourcesFailed('entries', failed.map((r) => ({ source: r.label, error: r.error! })));
    return results;
  },
});
