'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchBytes, fetchText } from './lib/http';
import { pdfLines } from './lib/pdf';
import { findRecordsPdfUrl, parseRecords, type UsawRecord } from './parse/records';

/**
 * USA Weightlifting American records (port of `usaw/records_scraper`): the
 * current records PDF linked from the American Records page, one row per
 * (age, gender, class) with snatch, clean & jerk and total, upserted as
 * record type USAW. Never deletes, as before.
 */
const PAGE_URL = 'https://www.usaweightlifting.org/american-records';


type RunResult = { pdfUrl: string; records: UsawRecord[]; inserted: number; updated: number };

export const run = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }): Promise<RunResult> => {
    const pdfUrl = findRecordsPdfUrl(await fetchText(PAGE_URL), PAGE_URL);
    if (!pdfUrl) throw new Error('records: no current American Records PDF on the page');
    const records = parseRecords(await pdfLines(await fetchBytes(pdfUrl, 120_000)));
    if (records.length === 0) throw new Error(`records: nothing parsed from ${pdfUrl}`);
    if (dryRun) return { pdfUrl, records, inserted: 0, updated: 0 };

    const outcomes: { wasInsert: boolean; wasChanged: boolean }[] = await ctx.runMutation(internal.ingest.upsertRecords, {
      rows: records.map((r) => ({
        recordType: r.record_type,
        ageCategory: r.age_category,
        gender: r.gender,
        weightClass: r.weight_class,
        snatchRecord: r.snatch_record,
        cjRecord: r.cj_record,
        totalRecord: r.total_record,
      })),
    });
    const inserted = records.filter((_, i) => outcomes[i].wasInsert);
    const updated = records.filter((_, i) => !outcomes[i].wasInsert && outcomes[i].wasChanged);
    console.log(`records: ${records.length} parsed, ${inserted.length} inserted, ${updated.length} updated`);
    return { pdfUrl, records, inserted: inserted.length, updated: updated.length };
  },
});
