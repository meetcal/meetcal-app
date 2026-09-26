'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchBytes, fetchText } from './lib/http';
import { pdfLines } from './lib/pdf';
import { postSlack } from './lib/slack';
import { findRecordsPdfUrl, parseRecords, type UsawRecord } from './parse/records';

/**
 * USA Weightlifting American records (port of `usaw/records_scraper`): the
 * current records PDF linked from the American Records page, one row per
 * (age, gender, class) with snatch, clean & jerk and total, upserted as
 * record type USAW. Never deletes, as before.
 */
const PAGE_URL = 'https://www.usaweightlifting.org/american-records';

function slackMessage(inserted: UsawRecord[], updated: UsawRecord[]): string {
  let message = `USA Weightlifting Records Update\n*${inserted.length}* new records inserted, *${updated.length}* records updated`;
  const more = (rows: UsawRecord[]) => (rows.length > 10 ? `\n... and ${rows.length - 10} more` : '');
  if (inserted.length) {
    message += `\n\n*New Records (${inserted.length}):*\n${inserted
      .slice(0, 10)
      .map((r) => `• ${r.age_category} ${r.gender} ${r.weight_class} (Snatch=${r.snatch_record}, CJ=${r.cj_record}, Total=${r.total_record})`)
      .join('\n')}${more(inserted)}`;
  }
  if (updated.length) {
    message += `\n\n*Updated Records (${updated.length}):*\n${updated
      .slice(0, 10)
      .map((r) => `• ${r.age_category} ${r.gender} ${r.weight_class}`)
      .join('\n')}${more(updated)}`;
  }
  return message;
}

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
    if (inserted.length || updated.length) {
      await postSlack(process.env.SLACK_RECORDS_WEBHOOK_URL, 'records', slackMessage(inserted, updated));
    }
    return { pdfUrl, records, inserted: inserted.length, updated: updated.length };
  },
});
