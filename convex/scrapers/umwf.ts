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
import { sourcesFailed, type SourceFailure } from '../lib/cronAlerts';
import { previewPrune, writeThenPrune } from './lib/prune';

/**
 * UMWF masters world records (port of `umwf_records.py`): one published
 * Google Sheet per gender, one tab per masters age group, read as CSV and
 * upserted as record type UMWF. A lift still at 0 ("Standard") is sent as
 * missing, as the Python scraper sent `None`.
 *
 * Each tab read is an exact set: its classes the tab no longer lists (a
 * retired class) are deleted (`ingest.pruneRecords`, for the tabs read only).
 * A tab that fails to download or parse, or parses to no records (its
 * layout changed), is skipped: its age group keeps its stored records.
 * Every other tab is still stored, then the run fails naming the skipped
 * tabs, so the alert fires instead of that age group silently going stale.
 */

type RunResult = { records: UmwfRecord[]; failedTabs: string[]; inserted: number; updated: number; deleted: string[]; pruneRefused?: string };

export const run = internalAction({
  // `allowShrink`: let the sync clear more stored lifts, or delete more
  // classes, than it otherwise may (`ingest.upsertRecords`,
  // `ingest.pruneRecords`), after checking the source by hand.
  args: { dryRun: v.optional(v.boolean()), allowShrink: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun, allowShrink }): Promise<RunResult> => {
    const records: UmwfRecord[] = [];
    // The tabs read, as the (age, gender) groups whose classes are pruned.
    const groups: { ageCategory: string; gender: string }[] = [];
    const failures: SourceFailure[] = [];
    for (const [baseUrl, sheets, gender] of [
      [MEN_BASE_URL, MEN_SHEETS, 'men'],
      [WOMEN_BASE_URL, WOMEN_SHEETS, 'women'],
    ] as const) {
      for (const [ageCategory, gid] of sheets) {
        const source = `${gender} ${ageCategory}`;
        try {
          const tab = parseUmwfSheet(await fetchText(sheetCsvUrl(baseUrl, gid)), ageCategory, gender);
          if (tab.length === 0) throw new Error('parsed 0 records (layout changed?)');
          records.push(...tab);
          groups.push({ ageCategory, gender });
        } catch (error) {
          failures.push({ source, error: (error as Error).message });
        }
      }
    }
    const failedTabs = failures.map(({ source, error }) => `${source}: ${error}`);
    if (failedTabs.length) console.error(`umwf: tabs skipped: ${failedTabs.join('; ')}`);
    if (records.length === 0) throw sourcesFailed('umwf: no records parsed', failures);
    const prune = (options: { allowShrink: boolean; dryRun: boolean }): Promise<{ deleted: string[] }> =>
      ctx.runMutation(internal.ingest.pruneRecords, {
        recordType: 'UMWF',
        keep: records.map((r) => ({ ageCategory: r.age_category, gender: r.gender, weightClass: r.weight_class })),
        groups,
        ...options,
      });
    if (dryRun) return { records, failedTabs, inserted: 0, updated: 0, ...(await previewPrune(prune, allowShrink ?? false)) };

    let result: { written: { wasInsert: boolean; wasChanged: boolean }[]; deleted: string[] };
    try {
      result = await writeThenPrune(prune, allowShrink ?? false, () =>
        ctx.runMutation(internal.ingest.upsertRecords, {
          allowShrink: allowShrink ?? false,
          rows: records.map((r) => ({
            recordType: r.record_type,
            ageCategory: r.age_category,
            gender: r.gender,
            weightClass: r.weight_class,
            snatchRecord: r.snatch_record || undefined,
            cjRecord: r.cj_record || undefined,
            totalRecord: r.total_record || undefined,
            snatchBy: r.snatch_by,
            cjBy: r.cj_by,
            totalBy: r.total_by,
          })),
        }),
      );
    } catch (error) {
      // A refused write fails the run with the skipped tabs still named, so
      // a tab failing alongside it still alerts.
      throw sourcesFailed('umwf: nothing stored', [...failures, { source: 'sync', error: (error as Error).message }]);
    }
    const inserted = result.written.filter((o) => o.wasInsert).length;
    const updated = result.written.filter((o) => !o.wasInsert && o.wasChanged).length;
    const { deleted } = result;
    console.log(`umwf: ${records.length} parsed, ${inserted} inserted, ${updated} updated, ${deleted.length} deleted${deleted.length ? ` (${deleted.join(', ')})` : ''}`);
    if (failures.length) throw sourcesFailed(`umwf: ${failures.length} tab(s) not stored, the rest was`, failures);
    return { records, failedTabs, inserted, updated, deleted };
  },
});
