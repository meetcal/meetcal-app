'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchBytes } from './lib/http';
import { fetchPageText } from './lib/incompleteChain';
import { pdfLines } from './lib/pdf';
import { previewPrune, writeThenPrune } from './lib/prune';
import { discoverHcamPdfs, parseHcamPages, type HcamRecord } from './parse/hcamRecords';
import { PAGE_URL } from './parse/usamw';

/**
 * Howard Cohen American Masters meet records: the current men's and women's
 * HCAM PDFs from the USA Masters records page, upserted as record type
 * USAMW_HCAM, then the classes they no longer list deleted
 * (`ingest.pruneRecords`, which refuses to delete many at once without
 * `allowShrink`). A PDF that yields no records fails the run before anything
 * is written, so a broken or swapped file never clears the stored records.
 */
type RunResult = { urls: { Men: string; Women: string }; records: HcamRecord[]; inserted: number; updated: number; unchanged: number; deleted: string[]; pruneRefused?: string };

export const run = internalAction({
  // `allowShrink`: let the sync clear more stored lifts, or delete more
  // classes, than it otherwise may (`ingest.upsertRecords`,
  // `ingest.pruneRecords`), after checking the source by hand.
  args: { dryRun: v.optional(v.boolean()), allowShrink: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun, allowShrink }): Promise<RunResult> => {
    const urls = discoverHcamPdfs(await fetchPageText(PAGE_URL, 45_000));
    const records: HcamRecord[] = [];
    for (const gender of ['Men', 'Women'] as const) {
      const pages = await pdfLines(await fetchBytes(urls[gender], 45_000), { xTolerance: 2, yTolerance: 2 });
      const parsed = parseHcamPages(pages, gender);
      if (parsed.length === 0) throw new Error(`hcam: parsed 0 ${gender.toLowerCase()}'s records from ${urls[gender]}`);
      records.push(...parsed);
    }
    const prune = (options: { allowShrink: boolean; dryRun: boolean }): Promise<{ deleted: string[] }> =>
      ctx.runMutation(internal.ingest.pruneRecords, {
        recordType: 'USAMW_HCAM',
        keep: records.map((r) => ({ ageCategory: r.ageCategory, gender: r.gender, weightClass: r.weightClass })),
        ...options,
      });
    if (dryRun) return { urls, records, inserted: 0, updated: 0, unchanged: 0, ...(await previewPrune(prune, allowShrink ?? false)) };

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
    console.log(`hcam: ${records.length} parsed, ${inserted} inserted, ${updated} updated, ${deleted.length} deleted${deleted.length ? ` (${deleted.join(', ')})` : ''}`);
    return { urls, records, inserted, updated, unchanged, deleted };
  },
});
