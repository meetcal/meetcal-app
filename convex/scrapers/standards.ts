'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchBytes, fetchText } from './lib/http';
import { currentStandards, findStandardsPdfUrl, parseStandards, type Standard } from './parse/standards';
import { pdfLines } from './lib/pdf';
import { previewPrune, writeThenPrune } from './lib/prune';

/**
 * USA Weightlifting A/B standards (port of `usaw/standards_scraper`): finds
 * the "Standards" PDF on the selection procedures page, reads each section
 * ("Senior Women's A Standards", then a `Category` line of weight classes and
 * a `Total` line of values) and syncs the standards in force today as an
 * exact set: a PDF that lists the classes before and after a class change
 * (one half "through July 31, 2026", the other "take effect August 1,
 * 2026") is stored as the half in force, and the classes it no longer lists
 * are deleted (`ingest.pruneStandards`, which refuses to delete many at once,
 * or a whole age group, without `allowShrink`; checked before anything is
 * written). "Today" is Colorado Springs' date, as USAW dates its changes.
 */
const PAGE_URL = 'https://www.usaweightlifting.org/resources/athlete-information-and-programs/selection-procedures';


type RunResult = { pdfUrl: string; standards: Standard[]; inserted: number; updated: number; deleted: string[]; pruneRefused?: string };

/** Today in Colorado Springs, where USA Weightlifting dates its class changes ("take effect August 1, 2026"). */
export function usawToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export const run = internalAction({
  // `allowShrink`: let the sync delete more classes than it otherwise may
  // (a class change retired them), after checking the PDF by hand. `dryRun`
  // lists what it would delete.
  args: { dryRun: v.optional(v.boolean()), allowShrink: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun, allowShrink }): Promise<RunResult> => {
    const pdfUrl = findStandardsPdfUrl(await fetchText(PAGE_URL), PAGE_URL);
    if (!pdfUrl) throw new Error('standards: no standards PDF link on the selection procedures page');
    const parsed = parseStandards(await pdfLines(await fetchBytes(pdfUrl)));
    if (parsed.length === 0) throw new Error(`standards: nothing parsed from ${pdfUrl}`);
    const standards = currentStandards(parsed, usawToday(new Date()));
    if (standards.length === 0) throw new Error(`standards: none of the ${parsed.length} parsed from ${pdfUrl} is in force today`);
    const prune = (options: { allowShrink: boolean; dryRun: boolean }): Promise<{ deleted: string[] }> =>
      ctx.runMutation(internal.ingest.pruneStandards, {
        keep: standards.map((s) => ({ ageCategory: s.age_category, gender: s.gender, weightClass: s.weight_class })),
        ...options,
      });
    if (dryRun) return { pdfUrl, standards, inserted: 0, updated: 0, ...(await previewPrune(prune, allowShrink ?? false)) };

    const { written: outcomes, deleted } = await writeThenPrune(
      prune,
      allowShrink ?? false,
      (): Promise<{ wasInsert: boolean; wasChanged: boolean }[]> =>
        ctx.runMutation(internal.ingest.upsertStandards, {
          rows: standards.map((s) => ({
            ageCategory: s.age_category,
            gender: s.gender,
            weightClass: s.weight_class,
            standardA: s.standard_a,
            standardB: s.standard_b,
          })),
        }),
    );
    const inserted = outcomes.filter((o) => o.wasInsert).length;
    const updated = outcomes.filter((o) => !o.wasInsert && o.wasChanged).length;
    console.log(`standards: ${standards.length} in force, ${inserted} inserted, ${updated} updated, ${deleted.length} deleted${deleted.length ? ` (${deleted.join(', ')})` : ''}`);
    return { pdfUrl, standards, inserted, updated, deleted };
  },
});
