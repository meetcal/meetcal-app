'use node';

import { v } from 'convex/values';
import { internalAction, type ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { absoluteUrl, fetchBytes, fetchText } from './lib/http';
import { unescapeHtml } from './lib/html';
import { pdfLines, pdfRunLines } from './lib/pdf';
import { gidOf, gvizCsvByGid, gvizCsvByName, sheetIdOf, type WsoRecord } from './parse/wso/common';
import { carolinaLayout, floridaLayout, parseSideBySide, type SideBySide } from './parse/wso/sideBySide';
import { consolidateRecords, parseNewJerseyTab } from './parse/wso/newJersey';
import { parseTnky } from './parse/wso/tnky';
import { OHIO_TABS, parseOhioTab } from './parse/wso/ohio';
import { PAWV_TABS, parsePawvTab, pawvCsvUrl } from './parse/wso/pawv';
import { illinoisPdfHref, parseIllinois } from './parse/wso/illinois';
import { mountainSouthPdfUrls, parseMountainSouth } from './parse/wso/mountainSouth';
import { newYorkPdfUrls, parseNewYork } from './parse/wso/newYork';
import { newEnglandPdfUrls, parseNewEngland } from './parse/wso/newEngland';
import { missouriValleyLines, parseMissouriValley } from './parse/wso/missouriValley';
import { fetchMissouriValleyPage } from './lib/missouriValley';
import { parseUsawTemplate } from './parse/wso/usawTemplate';
import { FLAT_COLUMNS, FLAT_SHEET_NAME, parseFlatSheet, type FlatColumns } from './parse/wso/flat';
import { normalizeAgeCategory, normalizeGender } from '../lib/normalize';

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
 * The tab the configured URL points at (its `gid`), else the one named
 * "Current Records". The Python scraper always asked for the name, and
 * California North's tab of that name switched to a human-readable layout
 * the parser cannot read: 0 records a night, while the gid tab still holds
 * the flat data.
 */
const flat = (wso: string, sheetUrl: string, columns: FlatColumns = FLAT_COLUMNS): WsoSource => ({
  wso,
  scrape: async () => {
    const sheetId = sheetIdOf(sheetUrl);
    const gid = gidOf(sheetUrl);
    const url = gid ? gvizCsvByGid(sheetId, gid) : gvizCsvByName(sheetId, FLAT_SHEET_NAME);
    return parseFlatSheet(await fetchText(url, 60_000), wso, columns);
  },
});

/** California South: the sheet's first tab, the value in "WSO record". */
const californiaSouth = (sheetUrl: string): WsoSource => ({
  wso: 'California South',
  scrape: async () =>
    parseFlatSheet(await fetchText(`https://docs.google.com/spreadsheets/d/${sheetIdOf(sheetUrl)}/gviz/tq?tqx=out:csv`, 60_000), 'California South', {
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

/** Sheets with a tab per age group (or stack of them), fetched together. */
const tabbed = (wso: string, sheetUrl: string, tabs: [gid: string, parse: TabParser][], finish = (records: WsoRecord[]) => records): WsoSource => ({
  wso,
  scrape: async () => {
    const sheetId = sheetIdOf(sheetUrl);
    const texts = await Promise.all(tabs.map(([gid]) => fetchText(gvizCsvByGid(sheetId, gid), 60_000)));
    return finish(everyPart(wso, tabs.map(([, parse], i) => parse(texts[i], wso)), (i) => `tab gid ${tabs[i][0]}`));
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

const DMV_COLUMNS: FlatColumns = { age: 'Age Group', gender: 'Gender', min: 'bodyWeightMin', max: 'Weight Class', lift: 'Lift', record: 'Record', name: 'Name', date: 'Date', location: 'Event' };

export const WSO_SOURCES: WsoSource[] = [
  flat('Georgia', 'https://docs.google.com/spreadsheets/d/1HM1H51pUmhoWDdSUp2RT-mCaUX2a8NB7aUSYVwWT0AU/edit?gid=908416148#gid=908416148'),
  flat('Pacific Northwest', 'https://docs.google.com/spreadsheets/d/1pmZ1j3KJyms0Dlk3xz_VVf6mWq6tqdZj/edit?gid=1648178012#gid=1648178012'),
  flat('California North', 'https://docs.google.com/spreadsheets/d/1ZAs27jQCPYTVgLuQ-feBHSO-BgGjGCewUs0djG23pXQ/edit?gid=35344992#gid=35344992'),
  flat('DMV', 'https://docs.google.com/spreadsheets/d/1vYD2H6si9FyEO-Tc24DoFZOmST0r5hCn/edit?gid=799684986#gid=799684986', DMV_COLUMNS),
  tabbed('Florida', 'https://docs.google.com/spreadsheets/d/16sNrOTnGrGeXE4L5skgCfE5vLTA7ggpaHWfMQNh0DfQ/view?gid=490899077#gid=490899077', [
    ['490899077', sideBySide(floridaLayout('U13'))],
    ['1300164988', sideBySide(floridaLayout('U15'))],
    ['1950298087', sideBySide(floridaLayout('U17'))],
    ['660284224', sideBySide(floridaLayout('Junior'))],
    ['662417948', sideBySide(floridaLayout('Senior'))],
    ['1222085467', sideBySide(floridaLayout('Masters 35'))],
    ['1267986954', sideBySide(floridaLayout('Masters 40'))],
    ['411054882', sideBySide(floridaLayout('Masters 45'))],
    ['1758139651', sideBySide(floridaLayout('Masters 50'))],
    ['1041309770', sideBySide(floridaLayout('Masters 55'))],
    ['1879007867', sideBySide(floridaLayout('Masters 60'))],
    ['1005330611', sideBySide(floridaLayout('Masters 65'))],
    ['1193133330', sideBySide(floridaLayout('Masters 70'))],
    ['373452428', sideBySide(floridaLayout('Masters 75'))],
    ['851164639', sideBySide(floridaLayout('Masters 80'))],
    ['1894058438', sideBySide(floridaLayout('Masters 85'))],
    ['575067900', sideBySide(floridaLayout('Masters 90'))],
  ]),
  tabbed('Carolina', 'https://docs.google.com/spreadsheets/d/1rKFzpkLCT-FE2SzM0qpUOoZ788YHl7dg/view?gid=1785893123#gid=1785893123', [
    ['1785893123', sideBySide(carolinaLayout('Youth'))],
    ['1157313505', sideBySide(carolinaLayout('Junior'))],
    ['2109027801', sideBySide(carolinaLayout('Senior'))],
    ['448005775', sideBySide(carolinaLayout('Masters'))],
  ]),
  tabbed(
    'New Jersey',
    'https://docs.google.com/spreadsheets/d/1y8mXDBLfqmszlzWhv-4wkeWQZS5Kb9Aj4RnB39CBJmw/edit?gid=0#gid=0',
    [
      ['0', newJersey('Senior')],
      ['336358523', newJersey('Junior')],
      ['2116279815', newJersey('U17')],
      ['1466042495', newJersey('U15')],
      ['1569406083', newJersey('U13')],
      ['575793496', newJersey('Masters 35')],
      ['2006037821', newJersey('Masters 40')],
      ['1977742090', newJersey('Masters 45')],
      ['1673511438', newJersey('Masters 50')],
      ['1894823432', newJersey('Masters 55')],
      ['1933132040', newJersey('Masters 60')],
      ['127836685', newJersey('Masters 65')],
      ['239397826', newJersey('Masters 70')],
      // 75-79 men, 75+ women. The men's 80+ tab the Python listed (gid
      // 389932308, all vacant) is gone; that gid is now the welcome page.
      ['2047529058', newJersey('Masters 75')],
    ],
    consolidateRecords,
  ),
  tabbed('Tennessee-Kentucky', 'https://docs.google.com/spreadsheets/d/11uUA0t05sEvHRjvDksC0VP1Yr2p_rC0JjHgVPEuYzhU/view?gid=867133960#gid=867133960', [
    ['867133960', parseTnky],
  ]),
  {
    wso: 'Ohio',
    scrape: async () => {
      const sheetId = sheetIdOf('https://docs.google.com/spreadsheets/d/1fX-Ft3PuLn8BCE2thhwPEXFTEUTN7yJGxWi7LMajAD8/view?gid=0#gid=0');
      const texts = await Promise.all(OHIO_TABS.map((tab) => fetchText(gvizCsvByName(sheetId, tab), 60_000)));
      return everyPart('Ohio', OHIO_TABS.map((tab, i) => parseOhioTab(texts[i], 'Ohio', tab)), (i) => `tab ${JSON.stringify(OHIO_TABS[i])}`);
    },
  },
  {
    wso: 'Pennsylvania-West Virginia',
    scrape: async () => {
      const publishedId = '2PACX-1vR8exp9-mwi8dpkZa9-48G-CUVuZ5rAlpOYdMCiNMka25wZ6V2XPLurpgMDtyiarqnQxYrW6dWfQ042';
      const texts = await Promise.all(PAWV_TABS.map((tab) => fetchText(pawvCsvUrl(publishedId, tab.gid), 60_000)));
      return everyPart('Pennsylvania-West Virginia', PAWV_TABS.map((tab, i) => parsePawvTab(texts[i], 'Pennsylvania-West Virginia', tab)), (i) => `tab gid ${PAWV_TABS[i].gid}`);
    },
  },
  {
    wso: 'Illinois',
    scrape: async () => {
      const page = 'https://www.illinoisweightlifting.com/';
      const pdfUrl = absoluteUrl(illinoisPdfHref(unescapeHtml(await fetchText(page))), page);
      const lines = (await pdfLines(await fetchBytes(pdfUrl))).flat();
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
      const pdfs = await Promise.all(urls.map(async (url) => pdfRunLines(await fetchBytes(url, 60_000))));
      return everyPart('Mountain South', pdfs.map((pages) => parseMountainSouth(pages, 'Mountain South')), (i) => urls[i]);
    },
  },
  {
    wso: 'New York',
    scrape: async () => {
      const urls = newYorkPdfUrls(await fetchText('https://www.nywso.com/state-records'));
      if (!urls.length) throw new Error('No records PDFs found on the New York records page');
      const pdfs = await Promise.all(urls.map(async (url) => pdfLines(await fetchBytes(url, 60_000))));
      return everyPart('New York', pdfs.map((pages) => parseNewYork(pages, 'New York')), (i) => urls[i]);
    },
  },
  {
    wso: 'New England',
    scrape: async () => {
      const urls = newEnglandPdfUrls(await fetchText('https://www.newenglandweightlifting.com/records'));
      if (!urls.length) throw new Error('No records PDFs found on the New England records page');
      const pdfs = await Promise.all(urls.map(async (url) => pdfRunLines(await fetchBytes(url, 60_000))));
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
      parseUsawTemplate(await fetchText('https://docs.google.com/spreadsheets/d/1tVJuneaIrPigqz5V9dLH9kKMbtU3sQC9/export?format=csv', 60_000), 'Minnesota-Dakotas'),
  },
  // The "Detailed" tab is the current set; TX and OK are the 2025 per-state tabs.
  {
    wso: 'Texas-Oklahoma',
    scrape: async () => parseUsawTemplate(await fetchText(gvizCsvByName('1gbLq6S4ebW7SGJy4ZyYJZ7ZjOCLjBedjIJzfp9AqIpI', 'Detailed'), 60_000), 'Texas-Oklahoma'),
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
    if (failed.length && !dryRun) throw new Error(`wso records: ${failed.map((r) => `${r.wso}: ${r.error}`).join('; ')}`);
    return results;
  },
});
