'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchText } from './lib/http';
import {
  MEN_BASE_URL,
  MEN_SHEETS,
  parseUmwfSheet,
  sheetCsvUrl,
  WOMEN_BASE_URL,
  WOMEN_SHEETS,
  type UmwfRecord,
} from './parse/umwf';

/**
 * UMWF masters world records (port of `umwf_records.py`): one published
 * Google Sheet per gender, one tab per masters age group, read as CSV and
 * upserted as record type UMWF. A lift still at 0 ("Standard") is sent as
 * missing, as the Python scraper sent `None`. A tab that fails to download is
 * skipped, as before.
 */

type RunResult = { records: UmwfRecord[]; failedTabs: string[]; inserted: number; updated: number };

export const run = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }): Promise<RunResult> => {
    const records: UmwfRecord[] = [];
    const failedTabs: string[] = [];
    for (const [baseUrl, sheets, gender] of [
      [MEN_BASE_URL, MEN_SHEETS, 'men'],
      [WOMEN_BASE_URL, WOMEN_SHEETS, 'women'],
    ] as const) {
      for (const [ageCategory, gid] of sheets) {
        try {
          records.push(...parseUmwfSheet(await fetchText(sheetCsvUrl(baseUrl, gid)), ageCategory, gender));
        } catch (error) {
          failedTabs.push(`${gender} ${ageCategory}: ${(error as Error).message}`);
        }
      }
    }
    if (failedTabs.length) console.error(`umwf: tabs skipped: ${failedTabs.join('; ')}`);
    if (records.length === 0) throw new Error('umwf: no records parsed');
    if (dryRun) return { records, failedTabs, inserted: 0, updated: 0 };

    const outcomes: { wasInsert: boolean; wasChanged: boolean }[] = await ctx.runMutation(internal.ingest.upsertRecords, {
      rows: records.map((r) => ({
        recordType: r.record_type,
        ageCategory: r.age_category,
        gender: r.gender,
        weightClass: r.weight_class,
        snatchRecord: r.snatch_record || undefined,
        cjRecord: r.cj_record || undefined,
        totalRecord: r.total_record || undefined,
      })),
    });
    const inserted = records.filter((_, i) => outcomes[i].wasInsert);
    const updated = records.filter((_, i) => !outcomes[i].wasInsert && outcomes[i].wasChanged);
    console.log(`umwf: ${records.length} parsed, ${inserted.length} inserted, ${updated.length} updated`);
    return { records, failedTabs, inserted: inserted.length, updated: updated.length };
  },
});
