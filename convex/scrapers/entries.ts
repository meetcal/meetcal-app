'use node';

import { errorMessage } from '../lib/errors';

import { v } from 'convex/values';
import { DAY_MS, isoDateOf } from '../lib/dates';
import { internalAction, type ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchJson } from './lib/http';
import { entriesEndpoint, entriesEventId, entryFromRow, meetFromTitle, readEntriesTable, unstoredEntriesMessage, type EntriesTable, type Entry, type EntryRow } from './parse/entries';
import { sourcesFailed } from '../lib/cronAlerts';
import { NOT_REACHED, runBudget } from './lib/budget';

async function getJson(url: string): Promise<EntriesTable> {
  return readEntriesTable(await fetchJson(url, { timeoutMs: 60_000 }));
}

/** A target's entries table's title, as the page's heading reads (one request). */
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

export function targetExpired(endDate: string, now: number, days = TARGET_RETENTION_DAYS): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return false;
  return endDate < isoDateOf(now - days * DAY_MS);
}

/**
 * Entries with each member's WSO from their other registrations, where one
 * names it (`queries.memberWsos`, #345): Sport80's entries list has none, so
 * without it the WSO dashboard and WSO registrations miss synced meets.
 */
async function withKnownWsos(ctx: ActionCtx, entries: Entry[]): Promise<Entry[]> {
  const ids = entries.map((entry) => entry.memberId);
  const wsos: Record<string, string> = {};
  for (let i = 0; i < ids.length; i += 500) {
    Object.assign(wsos, await ctx.runQuery(internal.scrapers.queries.memberWsos, { memberIds: ids.slice(i, i + 500) }));
  }
  return entries.map((entry) => (wsos[entry.memberId] ? { ...entry, wso: wsos[entry.memberId] } : entry));
}

type StoredTarget = { meet: string; title: string; completedOn?: string };

async function storedTarget(ctx: ActionCtx, url: string): Promise<StoredTarget> {
  const title = await fetchEntriesMeet(url);
  const eventId = entriesEventId(url);
  const stored: { name: string; status: string; endDate: string } | null = await ctx.runQuery(internal.scrapers.queries.entriesMeet, { sourceId: eventId, title });
  if (!stored) throw new Error(unstoredEntriesMessage(title, eventId, url));
  return { meet: stored.name, title, ...(stored.status === 'completed' ? { completedOn: stored.endDate } : {}) };
}

export async function readEntries(ctx: ActionCtx, url: string, meet: string): Promise<Entry[]> {
  return withKnownWsos(ctx, await fetchEntries(url, meet));
}

type MeetResult = {
  label: string;
  meet?: string;
  title?: string;
  entries?: number;
  inserted?: number;
  updated?: number;
  unchanged?: number;
  sessionSkipped?: number;
  notOnStartList?: number;
  rejected?: number;
  deleted?: number;
  sport80Listed?: boolean;
  withWso?: number;
  skipped?: string;
  error?: string;
  notReached?: boolean;
};

export const run = internalAction({
  // `allowShrink`: let a meet's entrants no longer on its list be deleted
  // past the share `ingest.upsertEntryAthletes` allows, after checking by hand.
  args: { dryRun: v.optional(v.boolean()), only: v.optional(v.array(v.string())), allowShrink: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun, only, allowShrink }): Promise<MeetResult[]> => {
    const targets = (await ctx.runQuery(internal.scrapers.entryTargets.list, {})).filter((t) => !only || only.includes(t.label) || only.includes(t.url));
    const results: MeetResult[] = [];
    const budget = runBudget();
    for (const target of targets) {
      const result: MeetResult = { label: target.label };
      results.push(result);
      if (budget.spent()) {
        result.error = NOT_REACHED;
        result.notReached = true;
        continue;
      }
      try {
        const stored = await budget.orStop(storedTarget(ctx, target.url));
        result.meet = stored.meet;
        if (stored.title !== stored.meet) result.title = stored.title;
        if (stored.completedOn !== undefined) {
          result.skipped = 'meet completed';
          if (!dryRun && targetExpired(stored.completedOn, Date.now())) {
            await ctx.runMutation(internal.scrapers.entryTargets.remove, { url: target.url });
            await ctx.runMutation(internal.ingest.forgetSport80Entrants, { meet: stored.meet });
            result.skipped = `meet completed ${stored.completedOn}, target removed`;
          }
          continue;
        }
        const entries = await budget.orStop(readEntries(ctx, target.url, stored.meet));
        result.entries = entries.length;
        result.withWso = entries.filter((entry) => entry.wso).length;
        if (dryRun || entries.length === 0) continue;
        const counts: { inserted: number; updated: number; unchanged: number; sessionSkipped: number; notOnStartList: number; rejected: number; deleted: number } = await ctx.runMutation(
          internal.ingest.upsertEntryAthletes,
          { meet: stored.meet, rows: entries, complete: true, ...(allowShrink ? { allowShrink } : {}) },
        );
        Object.assign(result, counts);
        const listed: { published: boolean } = await ctx.runMutation(internal.ingest.recordSport80Entrants, { meet: stored.meet, rows: entries });
        result.sport80Listed = listed.published;
      } catch (error) {
        result.error = errorMessage(error);
        console.error(`entries (${target.label}): ${result.error}`);
      }
    }
    const failures = results.flatMap(({ label, error, notReached }) => (error === undefined ? [] : [{ source: label, error, notReached }]));
    if (failures.length && !dryRun) throw sourcesFailed('entries', failures);
    return results;
  },
});
