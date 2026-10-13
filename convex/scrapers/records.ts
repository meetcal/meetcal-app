'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchBytes, fetchText } from './lib/http';
import { pdfLines } from './lib/pdf';
import { findRecordsPdfUrl, parseRecordsReport, type UsawRecord } from './parse/records';
import { sourcesFailed } from '../lib/cronAlerts';
import { previewPrune, writeThenPrune } from './lib/prune';

/**
 * USA Weightlifting American records (port of `usaw/records_scraper`): the
 * current records PDF linked from the American Records page, one row per
 * (age, gender, class) with snatch, clean & jerk and total, upserted as
 * record type USAW. The classes the PDF no longer lists (a class change) are
 * then deleted (`ingest.pruneRecords`, which refuses to delete many at once,
 * or a whole age group, without `allowShrink`; checked before anything is
 * written, `lib/prune.ts`), but only when every age group in it was read: an
 * age group the parser does not know (the PDF relabelled it) is not stored,
 * nothing is pruned, and the run fails naming it.
 */
const PAGE_URL = 'https://www.usaweightlifting.org/american-records';


type RunResult = {
  pdfUrl: string;
  records: UsawRecord[];
  inserted: number;
  updated: number;
  /** Classes deleted (with `dryRun`, that would be). */
  deleted: string[];
  unknownAgeGroups: string[];
  /** With `dryRun`: why the prune would refuse without `allowShrink`. */
  pruneRefused?: string;
};

type Outcome = { wasInsert: boolean; wasChanged: boolean };

const unknownAgeFailures = (codes: readonly string[]) =>
  codes.map((code) => ({ source: `age group ${code}`, error: `${JSON.stringify(code)} is not an age group the parser knows (parse/records.ts ageCategory); its rows were not stored` }));

export const run = internalAction({
  // `allowShrink`: let the sync clear more stored lifts, or delete more
  // classes, than it otherwise may (`ingest.upsertRecords`,
  // `ingest.pruneRecords`), after checking the source by hand. `dryRun`
  // lists what the prune would delete.
  args: { dryRun: v.optional(v.boolean()), allowShrink: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun, allowShrink }): Promise<RunResult> => {
    const pdfUrl = findRecordsPdfUrl(await fetchText(PAGE_URL), PAGE_URL);
    if (!pdfUrl) throw new Error('records: no current American Records PDF on the page');
    const { records, unknownAgeGroups } = parseRecordsReport(await pdfLines(await fetchBytes(pdfUrl, 120_000)));
    if (records.length === 0) {
      if (unknownAgeGroups.length) throw sourcesFailed(`records: nothing read from ${pdfUrl}`, unknownAgeFailures(unknownAgeGroups));
      throw new Error(`records: nothing parsed from ${pdfUrl}`);
    }
    const prune = (options: { allowShrink: boolean; dryRun: boolean }): Promise<{ deleted: string[] }> =>
      ctx.runMutation(internal.ingest.pruneRecords, {
        recordType: 'USAW',
        keep: records.map((r) => ({ ageCategory: r.age_category, gender: r.gender, weightClass: r.weight_class })),
        ...options,
      });
    if (dryRun) {
      const preview = unknownAgeGroups.length ? { deleted: [] } : await previewPrune(prune, allowShrink ?? false);
      return { pdfUrl, records, inserted: 0, updated: 0, unknownAgeGroups, ...preview };
    }

    const upsert = (): Promise<Outcome[]> =>
      ctx.runMutation(internal.ingest.upsertRecords, {
        allowShrink: allowShrink ?? false,
        rows: records.map((r) => ({
          recordType: r.record_type,
          ageCategory: r.age_category,
          gender: r.gender,
          weightClass: r.weight_class,
          snatchRecord: r.snatch_record,
          cjRecord: r.cj_record,
          totalRecord: r.total_record,
          snatchBy: r.snatch_by,
          cjBy: r.cj_by,
          totalBy: r.total_by,
        })),
      });
    const log = (outcomes: Outcome[], deleted: string[]) => {
      const inserted = outcomes.filter((o) => o.wasInsert).length;
      const updated = outcomes.filter((o) => !o.wasInsert && o.wasChanged).length;
      console.log(`records: ${records.length} parsed, ${inserted} inserted, ${updated} updated, ${deleted.length} deleted${deleted.length ? ` (${deleted.join(', ')})` : ''}`);
      return { inserted, updated };
    };
    // An age group the parser does not know: what was read is stored, but
    // nothing is pruned (its classes would all look dropped), and the run fails.
    if (unknownAgeGroups.length) {
      log(await upsert(), []);
      throw sourcesFailed('records: age groups not read, stale classes not pruned', unknownAgeFailures(unknownAgeGroups));
    }
    const { written, deleted } = await writeThenPrune(prune, allowShrink ?? false, upsert);
    return { pdfUrl, records, ...log(written, deleted), deleted, unknownAgeGroups };
  },
});
