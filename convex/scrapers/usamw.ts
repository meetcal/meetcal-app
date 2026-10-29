'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchBytes } from './lib/http';
import { fetchPageText } from './lib/incompleteChain';
import { pdfRunLines } from './lib/pdf';
import { previewPrune, writeThenPrune } from './lib/prune';
import { discoverRecordPdfs, PAGE_URL, parseRecordPages, PDF_OPTIONS, type UsamwRecord } from './parse/usamw';

/**
 * USA Masters Weightlifting national records (port of
 * `usamw/records/national_records.py`): the current men's and women's
 * national records PDFs from the records page, upserted as record type
 * USAMW, then the classes they no longer list deleted (`ingest.pruneRecords`,
 * which refuses to delete many at once without `allowShrink`).
 */
type RunResult = { urls: { Men: string; Women: string }; records: UsamwRecord[]; inserted: number; updated: number; unchanged: number; deleted: string[]; pruneRefused?: string; corrections: string[] };

export const run = internalAction({
  // `allowShrink`: let the sync clear more stored lifts, or delete more
  // classes, than it otherwise may (`ingest.upsertRecords`,
  // `ingest.pruneRecords`), after checking the source by hand.
  args: { dryRun: v.optional(v.boolean()), allowShrink: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun, allowShrink }): Promise<RunResult> => {
    const urls = discoverRecordPdfs(await fetchPageText(PAGE_URL, 45_000));
    const records: UsamwRecord[] = [];
    const corrections: string[] = [];
    for (const gender of ['Men', 'Women'] as const) {
      const pages = await pdfRunLines(await fetchBytes(urls[gender], 45_000), PDF_OPTIONS);
      records.push(...parseRecordPages(pages, gender, corrections));
    }
    for (const correction of corrections) console.log(`usamw: corrected ${correction}`);
    if (records.length === 0) throw new Error('usamw: parsed 0 national records');
    const prune = (options: { allowShrink: boolean; dryRun: boolean }): Promise<{ deleted: string[] }> =>
      ctx.runMutation(internal.ingest.pruneRecords, {
        recordType: 'USAMW',
        keep: records.map((r) => ({ ageCategory: r.ageCategory, gender: r.gender, weightClass: r.weightClass })),
        ...options,
      });
    if (dryRun) return { urls, records, inserted: 0, updated: 0, unchanged: 0, corrections, ...(await previewPrune(prune, allowShrink ?? false)) };

    const { written: outcomes, deleted } = await writeThenPrune(
      prune,
      allowShrink ?? false,
      (): Promise<{ wasInsert: boolean; wasChanged: boolean }[]> =>
        ctx.runMutation(internal.ingest.upsertRecords, {
          allowShrink: allowShrink ?? false,
          rows: records.map((r) => ({
            recordType: r.recordType,
            ageCategory: r.ageCategory,
            gender: r.gender,
            weightClass: r.weightClass,
            snatchRecord: r.snatchRecord ?? undefined,
            cjRecord: r.cjRecord ?? undefined,
            totalRecord: r.totalRecord ?? undefined,
            snatchBy: r.snatchBy,
            cjBy: r.cjBy,
            totalBy: r.totalBy,
          })),
        }),
    );
    const inserted = outcomes.filter((o) => o.wasInsert).length;
    const updated = outcomes.filter((o) => !o.wasInsert && o.wasChanged).length;
    const unchanged = outcomes.length - inserted - updated;
    console.log(`usamw: ${records.length} parsed, ${inserted} inserted, ${updated} updated, ${deleted.length} deleted${deleted.length ? ` (${deleted.join(', ')})` : ''}`);
    return { urls, records, inserted, updated, unchanged, deleted, corrections };
  },
});
