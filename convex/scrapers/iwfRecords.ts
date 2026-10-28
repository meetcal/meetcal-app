'use node';

import { v } from 'convex/values';
import { internalAction, type ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchJson, throttledOrTransient, withRetries, type RetryPolicy } from './lib/http';
import { BrowserlessKeyError, BrowserlessQuotaError, ChallengeError, fetchUnblockedHtml } from './lib/browserless';
import { sourcesFailed } from '../lib/cronAlerts';
import { normalizeAgeCategory, normalizeGender } from '../lib/normalize';
import type { RecordHolder } from './parse/holder';
import { IWF_PAGES, parseIwfWikitext, wikitextUrl, type IwfAge, type IwfRecord } from './parse/iwfRecords';
import { iwfSiteUrl, parseIwfSiteHtml } from './parse/iwfSite';

/**
 * IWF world records (replaces `iwf/world-records/scraper.py`): senior,
 * junior and youth, synced as the exact IWF set like `replaceIWFRecords`
 * did. They come from IWF's own pages (`parse/iwfSite.ts`), loaded through
 * Browserless because iwf.sport answers plain requests with a Cloudflare bot
 * challenge, when `BROWSERLESS_TOKEN` is set; from Wikipedia's lists
 * (`parse/iwfRecords.ts`) when it is not or when IWF's pages fail. Either
 * source is used whole, never mixed. The two write a holder differently
 * ("RI Song Gum", "Aichi-Nagoya" against "Ri Song-gum", "Asian Games,
 * Nagoya, Japan"), so a day that falls back keeps the stored holder of every
 * lift whose record has not changed (`keepStoredHolders`) rather than
 * rewriting them, and back again the next day.
 *
 * Wikipedia's API answers 503 now and then: a throttled, server-failed or
 * timed-out request is tried again after 2, 4 and 8 seconds, and if it still
 * fails the run is skipped with a warning, keeping the stored records (one
 * day's records are rarely new). A page that answers but cannot be read (a
 * 404, a changed table) still fails the run, so it alerts.
 */

// Wikimedia's User-Agent policy: name, version and contact, and what it is.
const WIKIPEDIA_USER_AGENT = 'MeetCal/1.0 (https://meetcal.app; https://github.com/meetcal/meetcal-app) iwf-world-records';
const WIKIPEDIA_TIMEOUT_MS = 15_000;
export const WIKIPEDIA_RETRY: RetryPolicy = { attempts: 4, delayMs: (attempt) => 2 ** attempt * 1000, retryIf: throttledOrTransient };

// A page through Browserless took 10 to 50 seconds when checked (October
// 2026; all six in 70). The budget bounds all six, so the Wikipedia fallback
// (at most 3 pages of 4 tries of 15 s and 14 s of waits, about 3.7 minutes)
// still fits in Convex's 10-minute action limit.
const IWF_TIMEOUT_MS = 60_000;
const IWF_BUDGET_MS = 5 * 60_000;
export const IWF_RETRY: RetryPolicy = {
  attempts: 2,
  delayMs: () => 2_000,
  retryIf: (error) => throttledOrTransient(error) || error instanceof ChallengeError,
};

const GENDERS = ['Men', 'Women'] as const;

async function fromIwfSite(token: string): Promise<IwfRecord[]> {
  const deadline = Date.now() + IWF_BUDGET_MS;
  const records: IwfRecord[] = [];
  for (const age of Object.keys(IWF_PAGES) as IwfAge[]) {
    for (const gender of GENDERS) {
      const url = iwfSiteUrl(age, gender);
      const html = await withRetries(() => {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`iwf.sport took over ${IWF_BUDGET_MS / 60_000} minutes`);
        return fetchUnblockedHtml(url, token, Math.min(IWF_TIMEOUT_MS, left));
      }, IWF_RETRY);
      records.push(...parseIwfSiteHtml(html, age, gender));
    }
  }
  return records;
}

async function wikitext(page: string): Promise<string> {
  const read = () => fetchJson(wikitextUrl(page), { timeoutMs: WIKIPEDIA_TIMEOUT_MS, headers: { 'User-Agent': WIKIPEDIA_USER_AGENT } });
  const body = (await withRetries(read, WIKIPEDIA_RETRY)) as { parse?: { wikitext?: string }; error?: { info?: string } };
  if (!body.parse?.wikitext) throw new Error(`Wikipedia ${page}: ${body.error?.info ?? 'no wikitext'}`);
  return body.parse.wikitext;
}

async function fromWikipedia(): Promise<IwfRecord[]> {
  const records: IwfRecord[] = [];
  // One page at a time, as Wikimedia's API etiquette asks.
  for (const [age, page] of Object.entries(IWF_PAGES) as [IwfAge, string][]) records.push(...parseIwfWikitext(await wikitext(page), age));
  return records;
}

type StoredRecord = Partial<Record<'snatchRecord' | 'cjRecord' | 'totalRecord', number>> &
  Partial<Record<'snatchBy' | 'cjBy' | 'totalBy', RecordHolder>> & { ageCategory: string; gender: string; weightClass: string };

const LIFT_HOLDERS = [
  ['snatchRecord', 'snatchBy'],
  ['cjRecord', 'cjBy'],
  ['totalRecord', 'totalBy'],
] as const;

/** `records` with the stored holder kept for every lift whose record is the stored one. */
export function keepStoredHolders(records: readonly IwfRecord[], stored: readonly StoredRecord[]): IwfRecord[] {
  const keyOf = (r: { ageCategory: string; gender: string; weightClass: string }) =>
    JSON.stringify([normalizeAgeCategory(r.ageCategory), normalizeGender(r.gender), r.weightClass]);
  const byKey = new Map(stored.map((r) => [keyOf(r), r]));
  return records.map((record) => {
    const before = byKey.get(keyOf(record));
    if (!before) return record;
    const kept = { ...record };
    for (const [lift, holder] of LIFT_HOLDERS) {
      const storedHolder = before[holder];
      if (before[lift] === record[lift] && storedHolder) kept[holder] = storedHolder;
    }
    return kept;
  });
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Source = 'iwf.sport' | 'wikipedia';
type RunResult = { source: Source | 'skipped'; records: IwfRecord[]; inserted: number; updated: number; deleted: number; unchanged: number; changes: string[] };

const NOTHING = { inserted: 0, updated: 0, deleted: 0, unchanged: 0, changes: [] };

/**
 * What a run with a refused Browserless token throws once it has used
 * Wikipedia (or failed there too): the cron alert emails it, and Convex's
 * exception reporting sends it to Sentry, so a broken token is noticed.
 */
function tokenRefused(refused: BrowserlessKeyError, wikipediaFailure?: unknown) {
  const failures = [{ source: 'browserless', error: refused.message }];
  if (wikipediaFailure !== undefined) failures.push({ source: 'wikipedia', error: message(wikipediaFailure) });
  return sourcesFailed('iwf-world-records read Wikipedia instead of iwf.sport', failures);
}

export const run = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }): Promise<RunResult> => {
    let found: { source: Source; records: IwfRecord[] } | undefined;
    let refused: BrowserlessKeyError | undefined;
    const token = process.env.BROWSERLESS_TOKEN;
    if (token) {
      try {
        found = { source: 'iwf.sport', records: await fromIwfSite(token) };
      } catch (error) {
        // Out of Browserless units (or its plan's browsers busy) is expected
        // on the free tier, not a fault: Wikipedia, logged as information
        // only. Other failures warn; a refused token also fails the run once
        // Wikipedia is stored (`tokenRefused`). Nothing else here throws, so
        // only that reaches Convex's exception reporting (Sentry).
        if (error instanceof BrowserlessQuotaError) console.log(`iwf-world-records: Browserless plan limit, using Wikipedia: ${error.message}`);
        else console.warn(`iwf-world-records: iwf.sport failed, using Wikipedia: ${message(error)}`);
        if (error instanceof BrowserlessKeyError) refused = error;
      }
    }
    let result: RunResult;
    try {
      result = await store(ctx, token, found, dryRun);
    } catch (error) {
      throw refused ? tokenRefused(refused, error) : error;
    }
    if (refused) throw tokenRefused(refused);
    return result;
  },
});

/** `found`, or Wikipedia's records when IWF's could not be read, stored (unless a dry run). */
async function store(ctx: ActionCtx, token: string | undefined, found: { source: Source; records: IwfRecord[] } | undefined, dryRun: boolean | undefined): Promise<RunResult> {
  if (!found) {
    try {
      found = { source: 'wikipedia', records: await fromWikipedia() };
    } catch (error) {
      if (!throttledOrTransient(error)) throw error;
      console.warn(`iwf-world-records: Wikipedia unavailable, run skipped and stored records kept: ${message(error)}`);
      return { source: 'skipped', records: [], ...NOTHING };
    }
  }
  const { source } = found;
  let { records } = found;
  if (token && source === 'wikipedia') {
    const stored: StoredRecord[] = await ctx.runQuery(internal.scrapers.queries.storedRecords, { recordType: 'IWF' });
    records = keepStoredHolders(records, stored);
  }
  if (dryRun) return { source, records, ...NOTHING };
  const result: Omit<RunResult, 'source' | 'records'> = await ctx.runMutation(internal.ingest.replaceRecordSet, {
    recordType: 'IWF',
    rows: records.map((r) => ({ recordType: 'IWF', ...r })),
  });
  return { source, records, ...result };
}
