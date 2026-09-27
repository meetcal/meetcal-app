'use node';

import { v } from 'convex/values';
import { internalAction, type ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchText } from './lib/http';
import { postSlack } from './lib/slack';
import { gidOf, gvizCsvByGid, gvizCsvByName, sheetIdOf, type WsoRecord } from './parse/wso/common';
import { FLAT_COLUMNS, FLAT_SHEET_NAME, parseFlatSheet, type FlatColumns } from './parse/wso/flat';

/**
 * WSO records (port of the `wso-records` job: one scraper per WSO in
 * `usaw/wso_sheets_scraper/auto_scrapers`). Every WSO runs even when an
 * earlier one failed; the run fails at the end if any did, as the shell loop
 * reported it.
 */
type WsoSource = { wso: string; scrape: () => Promise<WsoRecord[]> };

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

const DMV_COLUMNS: FlatColumns = { age: 'Age Group', gender: 'Gender', min: 'bodyWeightMin', max: 'Weight Class', lift: 'Lift', record: 'Record' };

export const WSO_SOURCES: WsoSource[] = [
  flat('Georgia', 'https://docs.google.com/spreadsheets/d/1HM1H51pUmhoWDdSUp2RT-mCaUX2a8NB7aUSYVwWT0AU/edit?gid=908416148#gid=908416148'),
  flat('Pacific Northwest', 'https://docs.google.com/spreadsheets/d/1pmZ1j3KJyms0Dlk3xz_VVf6mWq6tqdZj/edit?gid=1648178012#gid=1648178012'),
  flat('California North', 'https://docs.google.com/spreadsheets/d/1ZAs27jQCPYTVgLuQ-feBHSO-BgGjGCewUs0djG23pXQ/edit?gid=35344992#gid=35344992'),
  flat('DMV', 'https://docs.google.com/spreadsheets/d/1vYD2H6si9FyEO-Tc24DoFZOmST0r5hCn/edit?gid=799684986#gid=799684986', DMV_COLUMNS),
  californiaSouth('https://docs.google.com/spreadsheets/d/1PHYJ-lhkXYMrQIIo6YaipePFxruSfbRw1TEUtIoknR0/edit?usp=sharing'),
];

const kg = (value: number | null | undefined) => (value ? `${value}kg` : 'None');

function slackMessage(wso: string, inserted: WsoRecord[], updated: { record: WsoRecord; previous: Record<string, number | undefined> }[]): string {
  let message = `*${wso} WSO Records Update*\n\n*Summary:*\n• ${inserted.length} new record(s) inserted\n• ${updated.length} record(s) updated`;
  if (inserted.length) {
    message += '\n\n🆕 *New Records*\n';
    for (const r of inserted.slice(0, 10)) {
      const lifts = [r.snatch_record && `Snatch: ${r.snatch_record}kg`, r.cj_record && `C&J: ${r.cj_record}kg`, r.total_record && `Total: ${r.total_record}kg`].filter(Boolean);
      message += `• *${r.age_category}* | ${r.gender} | ${r.weight_class}\n  ${lifts.length ? lifts.join(', ') : 'No records'}\n`;
    }
    if (inserted.length > 10) message += `_...and ${inserted.length - 10} more_\n`;
  }
  if (updated.length) {
    message += '\n📝 *Updated Records*\n';
    for (const { record: r, previous } of updated.slice(0, 10)) {
      const changes = (
        [
          ['Snatch', previous.snatchRecord, r.snatch_record],
          ['C&J', previous.cjRecord, r.cj_record],
          ['Total', previous.totalRecord, r.total_record],
        ] as const
      )
        .filter(([, old, now]) => (old ?? null) !== now)
        .map(([name, old, now]) => `${name}: ${kg(old)} → ${kg(now)}`);
      message += `• *${r.age_category}* | ${r.gender} | ${r.weight_class}\n  ${changes.join(', ')}\n`;
    }
    if (updated.length > 10) message += `_...and ${updated.length - 10} more_\n`;
  }
  return message;
}

async function syncWso(ctx: ActionCtx, wso: string, records: WsoRecord[]) {
  const outcomes: { wasInsert: boolean; wasChanged: boolean; previous?: Record<string, number | undefined> }[] = await ctx.runMutation(
    internal.ingest.upsertWsoRecords,
    {
      rows: records.map((r) => ({
        wso: r.wso,
        ageCategory: r.age_category,
        gender: r.gender,
        weightClass: r.weight_class,
        snatchRecord: r.snatch_record ?? undefined,
        cjRecord: r.cj_record ?? undefined,
        totalRecord: r.total_record ?? undefined,
      })),
    },
  );
  const inserted = records.filter((_, i) => outcomes[i].wasInsert);
  const updated = records.flatMap((record, i) => (!outcomes[i].wasInsert && outcomes[i].wasChanged ? [{ record, previous: outcomes[i].previous ?? {} }] : []));
  if (inserted.length || updated.length) await postSlack(process.env.SLACK_WSO_WEBHOOK_URL, `wso ${wso}`, slackMessage(wso, inserted, updated));
  return { inserted: inserted.length, updated: updated.length, unchanged: records.length - inserted.length - updated.length };
}

type WsoResult = { wso: string; records: WsoRecord[]; inserted: number; updated: number; unchanged: number; error?: string };

export const run = internalAction({
  args: { dryRun: v.optional(v.boolean()), only: v.optional(v.array(v.string())) },
  handler: async (ctx, { dryRun, only }): Promise<WsoResult[]> => {
    const results: WsoResult[] = [];
    for (const source of WSO_SOURCES.filter((s) => !only || only.includes(s.wso))) {
      const result: WsoResult = { wso: source.wso, records: [], inserted: 0, updated: 0, unchanged: 0 };
      results.push(result);
      try {
        result.records = await source.scrape();
        if (!dryRun && result.records.length) Object.assign(result, await syncWso(ctx, source.wso, result.records));
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
