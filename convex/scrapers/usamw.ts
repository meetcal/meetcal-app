'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchBytes, fetchText } from './lib/http';
import { pdfLines } from './lib/pdf';
import { postSlack } from './lib/slack';
import { discoverRecordPdfs, PAGE_URL, parseRecordPages, type UsamwRecord } from './parse/usamw';

/**
 * USA Masters Weightlifting national records (port of
 * `usamw/records/national_records.py`): the current men's and women's
 * national records PDFs from the records page, upserted as record type USAMW.
 * Slack posts only when something changed.
 */
type RunResult = { urls: { Men: string; Women: string }; records: UsamwRecord[]; inserted: number; updated: number; unchanged: number };

export const run = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }): Promise<RunResult> => {
    const urls = discoverRecordPdfs(await fetchText(PAGE_URL, 45_000));
    const records: UsamwRecord[] = [];
    for (const gender of ['Men', 'Women'] as const) {
      const pages = await pdfLines(await fetchBytes(urls[gender], 45_000), { xTolerance: 2, yTolerance: 2 });
      records.push(...parseRecordPages(pages, gender));
    }
    if (records.length === 0) throw new Error('usamw: parsed 0 national records');
    if (dryRun) return { urls, records, inserted: 0, updated: 0, unchanged: 0 };

    const outcomes: { wasInsert: boolean; wasChanged: boolean }[] = await ctx.runMutation(internal.ingest.upsertRecords, {
      rows: records.map((r) => ({
        recordType: r.recordType,
        ageCategory: r.ageCategory,
        gender: r.gender,
        weightClass: r.weightClass,
        snatchRecord: r.snatchRecord ?? undefined,
        cjRecord: r.cjRecord ?? undefined,
        totalRecord: r.totalRecord ?? undefined,
      })),
    });
    const inserted = outcomes.filter((o) => o.wasInsert).length;
    const updated = outcomes.filter((o) => !o.wasInsert && o.wasChanged).length;
    const unchanged = outcomes.length - inserted - updated;
    console.log(`usamw: ${records.length} parsed, ${inserted} inserted, ${updated} updated`);
    if (inserted + updated > 0) {
      await postSlack(
        process.env.SLACK_USAMW_RECORDS_WEBHOOK_URL ?? process.env.SLACK_RECORDS_WEBHOOK_URL,
        'usamw records',
        `USAMW national records update complete\n${records.length} parsed records\n` +
          `convex: ${inserted} inserted, ${updated} updated, ${unchanged} unchanged`,
      );
    }
    return { urls, records, inserted, updated, unchanged };
  },
});
