'use node';

import { v } from 'convex/values';
import { internalAction, type ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { absoluteUrl, fetchPdf, fetchText, mapLimited, throttledOrTransient, withRetries, type RetryPolicy } from './lib/http';
import { unescapeHtml } from './lib/html';
import { pdfLines, pdfRunLines } from './lib/pdf';
import {
  gidOf,
  gvizCsvByGid,
  gvizCsvFirstTab,
  resolveTabs,
  sheetHtmlViewUrl,
  sheetIdOf,
  sheetTabList,
  type SheetTab,
  type TabRef,
  type WsoRecord,
} from './parse/wso/common';
import { carolinaLayout, floridaLayout, parseSideBySide, type SideBySide } from './parse/wso/sideBySide';
import { consolidateRecords, NEW_JERSEY_TABS, parseNewJerseyTab } from './parse/wso/newJersey';
import { parseTnkyTab, TNKY_SHEET_ID, tnkyTabs } from './parse/wso/tnky';
import { OHIO_SHEET_ID, OHIO_TAB_GIDS, OHIO_TABS, parseOhioTab } from './parse/wso/ohio';
import { PAWV_TABS, parsePawvTab, pawvCsvUrl } from './parse/wso/pawv';
import { illinoisPdfHref, parseIllinois } from './parse/wso/illinois';
import { mountainSouthPdfUrls, parseMountainSouth } from './parse/wso/mountainSouth';
import { newYorkPdfUrls, parseNewYork } from './parse/wso/newYork';
import { newEnglandPdfUrls, parseNewEngland } from './parse/wso/newEngland';
import { missouriValleyLines, parseMissouriValley } from './parse/wso/missouriValley';
import { fetchMissouriValleyPage } from './lib/missouriValley';
import { parseUsawTemplate } from './parse/wso/usawTemplate';
import { FLAT_COLUMNS, parseFlatSheet, type FlatColumns } from './parse/wso/flat';
import { normalizeAgeCategory, normalizeGender } from '../lib/normalize';
import { sourcesFailed } from '../lib/cronAlerts';

/**
 * WSO records (port of the `wso-records` job: one scraper per WSO in
 * `usaw/wso_sheets_scraper/auto_scrapers`). Every WSO runs even when an
 * earlier one failed; the run fails at the end if any did, as the shell loop
 * reported it.
 *
 * Each WSO's records are synced as an exact set: a class or age group its
 * file no longer lists (the weight classes it replaced, an age group it
 * renamed) is deleted, not left beside the new ones. A source that parses to
 * nothing fails instead, so a broken sheet never empties a WSO.
 */
type WsoSource = {
  wso: string;
  scrape: () => Promise<WsoRecord[]>;
};

/**
 * Google answers a burst of sheet requests with 429 (Tennessee-Kentucky's
 * 21 tabs, fetched at once, failed so in October 2026): a Google request is
 * tried again after 2, 4 and 8 seconds, and a WSO's tabs are fetched
 * `SHEET_CONCURRENCY` at a time.
 */
export const SHEET_RETRY: RetryPolicy = { attempts: 4, delayMs: (attempt) => 2 ** attempt * 1000, retryIf: throttledOrTransient };
export const SHEET_CONCURRENCY = 4;
const SHEET_TIMEOUT_MS = 60_000;

/** A Google Sheets page or CSV, retried when Google throttles it (`SHEET_RETRY`). */
export const fetchSheetText = (url: string) => withRetries(() => fetchText(url, SHEET_TIMEOUT_MS), SHEET_RETRY);

/** The sheet's visible tabs, from its HTML view. */
async function fetchTabList(sheetId: string): Promise<SheetTab[]> {
  return sheetTabList(await fetchSheetText(sheetHtmlViewUrl(sheetId)));
}

/**
 * The tabs' CSVs, each tab named by gid or by name and checked against the
 * sheet's visible tabs first (`resolveTabs`): a tab hidden, renamed or
 * deleted fails the source, rather than Google serving the hidden tab's
 * stale records, or its first tab in place of a deleted one. `headers` is
 * passed on to `gvizCsvByGid`; `list` is the tab list when already fetched.
 */
async function fetchTabs(sheetId: string, refs: readonly TabRef[], { headers, list }: { headers?: number; list?: readonly SheetTab[] } = {}): Promise<string[]> {
  const gids = resolveTabs(list ?? (await fetchTabList(sheetId)), refs);
  return await mapLimited(gids, SHEET_CONCURRENCY, (gid) => fetchSheetText(gvizCsvByGid(sheetId, gid, headers)));
}

/**
 * A flat sheet's tab: `tab` by name, else the tab the URL points at (its
 * `gid`). The Python scraper asked Google for the tab named "Current
 * Records", and California North's tab of that name switched to a
 * human-readable layout the parser cannot read: 0 records a night. A name
 * Google does not know serves the first tab, so names are only looked up
 * in the sheet's tab list, and a URL without a gid or `tab` is refused.
 */
const flat = (
  wso: string,
  sheetUrl: string,
  { columns = FLAT_COLUMNS, tab, headers }: { columns?: FlatColumns; tab?: string; headers?: number } = {},
): WsoSource => ({
  wso,
  scrape: async () => {
    const gid = gidOf(sheetUrl);
    const ref: TabRef | null = tab !== undefined ? { name: tab } : gid ? { gid } : null;
    if (!ref) throw new Error(`${wso}: the sheet URL names no tab (gid)`);
    const [csv] = await fetchTabs(sheetIdOf(sheetUrl), [ref], { headers });
    return parseFlatSheet(csv, wso, columns);
  },
});

/** California South: the sheet's first tab, the value in "WSO record". */
const californiaSouth = (sheetUrl: string): WsoSource => ({
  wso: 'California South',
  scrape: async () =>
    parseFlatSheet(await fetchSheetText(gvizCsvFirstTab(sheetIdOf(sheetUrl))), 'California South', {
      ...FLAT_COLUMNS,
      record: 'WSO record',
    }),
});

type TabParser = (csv: string, wso: string) => WsoRecord[];

/**
 * The records of a source read in parts (a tab or PDF each), refusing a part
 * that parsed to nothing: the sync is an exact set, so one broken part would
 * otherwise delete its age groups while the rest looked fine.
 */
function everyPart(wso: string, parts: WsoRecord[][], label: (i: number) => string): WsoRecord[] {
  const empty = parts.map((records, i) => (records.length === 0 ? label(i) : null)).filter((part) => part !== null);
  if (empty.length) throw new Error(`${wso}: parsed 0 records from ${empty.join(', ')} (layout changed?)`);
  return parts.flat();
}

const tabLabel = (ref: TabRef) => ('gid' in ref ? `tab gid ${ref.gid}` : `tab ${JSON.stringify(ref.name)}`);

/** Sheets with a tab per age group (or stack of them), fetched together. */
const tabbed = (
  wso: string,
  sheetUrl: string,
  tabs: [tab: TabRef, parse: TabParser][],
  { finish = (records: WsoRecord[]) => records }: { finish?: (records: WsoRecord[]) => WsoRecord[] } = {},
): WsoSource => ({
  wso,
  scrape: async () => {
    const texts = await fetchTabs(sheetIdOf(sheetUrl), tabs.map(([tab]) => tab));
    return finish(everyPart(wso, tabs.map(([, parse], i) => parse(texts[i], wso)), (i) => tabLabel(tabs[i][0])));
  },
});

const sideBySide =
  (layout: SideBySide): TabParser =>
  (csv, wso) =>
    parseSideBySide(csv, wso, layout);

const newJersey =
  (age: string): TabParser =>
  (csv, wso) =>
    parseNewJerseyTab(csv, wso, age);

/** A sheet in USAW's record template, its warnings logged. */
function usawTemplate(csv: string, wso: string): WsoRecord[] {
  const { records, warnings } = parseUsawTemplate(csv, wso);
  for (const warning of warnings) console.log(`wso records (${wso}): ${warning}`);
  return records;
}

const DMV_COLUMNS: FlatColumns = { age: 'Age Group', gender: 'Gender', min: 'bodyWeightMin', max: 'Weight Class', lift: 'Lift', record: 'Record', name: 'Name', date: 'Date', location: 'Event' };

export const WSO_SOURCES: WsoSource[] = [
  flat('Georgia', 'https://docs.google.com/spreadsheets/d/1HM1H51pUmhoWDdSUp2RT-mCaUX2a8NB7aUSYVwWT0AU/edit?gid=908416148#gid=908416148'),
  flat('Pacific Northwest', 'https://docs.google.com/spreadsheets/d/1pmZ1j3KJyms0Dlk3xz_VVf6mWq6tqdZj/edit?gid=1648178012#gid=1648178012'),
  // The tab of the classes in force since 1 August 2026, by name. The gid
  // read before (35344992) is a hidden tab of the classes retired then.
  // Google guesses a header for this tab that drops some column names.
  flat('California North', 'https://docs.google.com/spreadsheets/d/1ZAs27jQCPYTVgLuQ-feBHSO-BgGjGCewUs0djG23pXQ/edit', { tab: 'Post-Aug2026', headers: 1 }),
  flat('DMV', 'https://docs.google.com/spreadsheets/d/1vYD2H6si9FyEO-Tc24DoFZOmST0r5hCn/edit?gid=799684986#gid=799684986', { columns: DMV_COLUMNS }),
  tabbed('Florida', 'https://docs.google.com/spreadsheets/d/16sNrOTnGrGeXE4L5skgCfE5vLTA7ggpaHWfMQNh0DfQ/view?gid=490899077#gid=490899077', [
    [{ gid: '490899077' }, sideBySide(floridaLayout('U13'))],
    [{ gid: '1300164988' }, sideBySide(floridaLayout('U15'))],
    [{ gid: '1950298087' }, sideBySide(floridaLayout('U17'))],
    [{ gid: '660284224' }, sideBySide(floridaLayout('Junior'))],
    [{ gid: '662417948' }, sideBySide(floridaLayout('Senior'))],
    [{ gid: '1222085467' }, sideBySide(floridaLayout('Masters 35'))],
    [{ gid: '1267986954' }, sideBySide(floridaLayout('Masters 40'))],
    [{ gid: '411054882' }, sideBySide(floridaLayout('Masters 45'))],
    [{ gid: '1758139651' }, sideBySide(floridaLayout('Masters 50'))],
    [{ gid: '1041309770' }, sideBySide(floridaLayout('Masters 55'))],
    [{ gid: '1879007867' }, sideBySide(floridaLayout('Masters 60'))],
    [{ gid: '1005330611' }, sideBySide(floridaLayout('Masters 65'))],
    [{ gid: '1193133330' }, sideBySide(floridaLayout('Masters 70'))],
    [{ gid: '373452428' }, sideBySide(floridaLayout('Masters 75'))],
    [{ gid: '851164639' }, sideBySide(floridaLayout('Masters 80'))],
    [{ gid: '1894058438' }, sideBySide(floridaLayout('Masters 85'))],
    [{ gid: '575067900' }, sideBySide(floridaLayout('Masters 90'))],
  ]),
  tabbed('Carolina', 'https://docs.google.com/spreadsheets/d/1rKFzpkLCT-FE2SzM0qpUOoZ788YHl7dg/view?gid=1785893123#gid=1785893123', [
    [{ gid: '1785893123' }, sideBySide(carolinaLayout('Youth'))],
    [{ gid: '1157313505' }, sideBySide(carolinaLayout('Junior'))],
    [{ gid: '2109027801' }, sideBySide(carolinaLayout('Senior'))],
    [{ gid: '448005775' }, sideBySide(carolinaLayout('Masters'))],
  ]),
  tabbed(
    'New Jersey',
    'https://docs.google.com/spreadsheets/d/1y8mXDBLfqmszlzWhv-4wkeWQZS5Kb9Aj4RnB39CBJmw/edit?gid=0#gid=0',
    NEW_JERSEY_TABS.map(([name, age]) => [{ name }, newJersey(age)]),
    { finish: consolidateRecords },
  ),
  // A tab per group, found by its title (`tnkyTabs`), read with one header row.
  {
    wso: 'Tennessee-Kentucky',
    scrape: async () => {
      const list = await fetchTabList(TNKY_SHEET_ID);
      const tabs = tnkyTabs(list);
      const texts = await fetchTabs(TNKY_SHEET_ID, tabs.map(({ gid }) => ({ gid })), { headers: 1, list });
      return everyPart('Tennessee-Kentucky', tabs.map((tab, i) => parseTnkyTab(texts[i], 'Tennessee-Kentucky', tab.age, tab.gender)), (i) => `tab ${JSON.stringify(tabs[i].name)}`);
    },
  },
  {
    wso: 'Ohio',
    scrape: async () => {
      const texts = await fetchTabs(OHIO_SHEET_ID, OHIO_TABS.map((tab) => ({ gid: OHIO_TAB_GIDS[tab] })));
      return everyPart('Ohio', OHIO_TABS.map((tab, i) => parseOhioTab(texts[i], 'Ohio', tab)), (i) => `tab ${JSON.stringify(OHIO_TABS[i])}`);
    },
  },
  {
    wso: 'Pennsylvania-West Virginia',
    scrape: async () => {
      const publishedId = '2PACX-1vR8exp9-mwi8dpkZa9-48G-CUVuZ5rAlpOYdMCiNMka25wZ6V2XPLurpgMDtyiarqnQxYrW6dWfQ042';
      const texts = await mapLimited(PAWV_TABS, SHEET_CONCURRENCY, (tab) => fetchSheetText(pawvCsvUrl(publishedId, tab.gid)));
      return everyPart('Pennsylvania-West Virginia', PAWV_TABS.map((tab, i) => parsePawvTab(texts[i], 'Pennsylvania-West Virginia', tab)), (i) => `tab gid ${PAWV_TABS[i].gid}`);
    },
  },
  {
    wso: 'Illinois',
    scrape: async () => {
      const page = 'https://www.illinoisweightlifting.com/';
      const pdfUrl = absoluteUrl(illinoisPdfHref(unescapeHtml(await fetchText(page))), page);
      const lines = (await pdfLines(await fetchPdf(pdfUrl))).flat();
      const { records, warnings } = parseIllinois(lines, 'Illinois');
      for (const warning of warnings) console.log(`wso records (Illinois): ${warning}`);
      return records;
    },
  },
  {
    wso: 'Mountain South',
    scrape: async () => {
      const urls = mountainSouthPdfUrls(await fetchText('https://mountainsouth.org/records/'));
      if (!urls.length) throw new Error('No records PDFs found on the Mountain South records page');
      const pdfs = await Promise.all(urls.map(async (url) => pdfRunLines(await fetchPdf(url, 60_000))));
      return everyPart('Mountain South', pdfs.map((pages) => parseMountainSouth(pages, 'Mountain South')), (i) => urls[i]);
    },
  },
  {
    wso: 'New York',
    scrape: async () => {
      const urls = newYorkPdfUrls(await fetchText('https://www.nywso.com/state-records'));
      if (!urls.length) throw new Error('No records PDFs found on the New York records page');
      const pdfs = await Promise.all(urls.map(async (url) => pdfLines(await fetchPdf(url, 60_000))));
      return everyPart('New York', pdfs.map((pages) => parseNewYork(pages, 'New York')), (i) => urls[i]);
    },
  },
  {
    wso: 'New England',
    scrape: async () => {
      const urls = newEnglandPdfUrls(await fetchText('https://www.newenglandweightlifting.com/records'));
      if (!urls.length) throw new Error('No records PDFs found on the New England records page');
      const pdfs = await Promise.all(urls.map(async (url) => pdfRunLines(await fetchPdf(url, 60_000))));
      return everyPart('New England', pdfs.map((pages) => parseNewEngland(pages, 'New England')), (i) => urls[i]);
    },
  },
  {
    wso: 'Missouri Valley',
    scrape: async () => parseMissouriValley(missouriValleyLines(await fetchMissouriValleyPage())),
  },
  californiaSouth('https://docs.google.com/spreadsheets/d/1PHYJ-lhkXYMrQIIo6YaipePFxruSfbRw1TEUtIoknR0/edit?usp=sharing'),
  // An uploaded Excel file with one dated tab ("20260627 MN-DAK"): its first sheet.
  {
    wso: 'Minnesota-Dakotas',
    scrape: async () =>
      usawTemplate(await fetchSheetText('https://docs.google.com/spreadsheets/d/1tVJuneaIrPigqz5V9dLH9kKMbtU3sQC9/export?format=csv'), 'Minnesota-Dakotas'),
  },
  // The "Detailed" tab (gid 1649080864) is the current set; TX and OK are
  // the 2025 per-state tabs. Read by gid: the Python asked for the name.
  {
    wso: 'Texas-Oklahoma',
    scrape: async () => {
      const [detailed] = await fetchTabs('1gbLq6S4ebW7SGJy4ZyYJZ7ZjOCLjBedjIJzfp9AqIpI', [{ gid: '1649080864' }]);
      return usawTemplate(detailed, 'Texas-Oklahoma');
    },
  },
];

const wsoRows = (records: WsoRecord[]) =>
  records.map((r) => ({
    wso: r.wso,
    ageCategory: r.age_category,
    gender: r.gender,
    weightClass: r.weight_class,
    snatchRecord: r.snatch_record ?? undefined,
    cjRecord: r.cj_record ?? undefined,
    totalRecord: r.total_record ?? undefined,
    snatchBy: r.snatch_by,
    cjBy: r.cj_by,
    totalBy: r.total_by,
  }));

/**
 * One record per class, the last listed winning, as it did when the Python
 * upserted row by row (New York's PDF lists Masters Men 80-84 twice).
 * Classes are compared as stored, after age and gender are normalized.
 */
function lastPerClass(records: WsoRecord[]): WsoRecord[] {
  const byClass = new Map<string, WsoRecord>();
  for (const record of records) {
    const key = JSON.stringify([normalizeAgeCategory(record.age_category), normalizeGender(record.gender), record.weight_class]);
    byClass.delete(key);
    byClass.set(key, record);
  }
  return [...byClass.values()];
}

/** Syncs the WSO's records to exactly the scraped set. */
async function replaceWso(
  ctx: ActionCtx,
  wso: string,
  records: WsoRecord[],
  allowShrink: boolean,
): Promise<{ inserted: number; updated: number; deleted: number; unchanged: number }> {
  return await ctx.runMutation(internal.ingest.replaceWsoRecordSet, { wso, rows: wsoRows(lastPerClass(records)), allowShrink });
}

type WsoResult = { wso: string; records: WsoRecord[]; inserted: number; updated: number; unchanged: number; deleted?: number; error?: string };

export const run = internalAction({
  // `allowShrink`: let a sync delete more than a quarter of a WSO's classes
  // (a source that really restructured), after checking the source by hand.
  args: { dryRun: v.optional(v.boolean()), only: v.optional(v.array(v.string())), allowShrink: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun, only, allowShrink }): Promise<WsoResult[]> => {
    const results: WsoResult[] = [];
    for (const source of WSO_SOURCES.filter((s) => !only || only.includes(s.wso))) {
      const result: WsoResult = { wso: source.wso, records: [], inserted: 0, updated: 0, unchanged: 0 };
      results.push(result);
      try {
        result.records = await source.scrape();
        // Every source has records; none means its sheet, tab or layout
        // changed, which must fail loudly rather than leave the old ones stale.
        if (result.records.length === 0) throw new Error('parsed 0 records (source layout changed?)');
        if (!dryRun) {
          Object.assign(result, await replaceWso(ctx, source.wso, result.records, allowShrink ?? false));
        }
      } catch (error) {
        result.error = (error as Error).message;
        console.error(`wso records (${source.wso}): ${result.error}`);
      }
    }
    const failed = results.filter((r) => r.error);
    if (failed.length && !dryRun) throw sourcesFailed('wso records', failed.map((r) => ({ source: r.wso, error: r.error! })));
    return results;
  },
});
