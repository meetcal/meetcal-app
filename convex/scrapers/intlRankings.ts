'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchBytes, fetchText } from './lib/http';
import { pdfLines } from './lib/pdf';
import {
  discoverRankingPdfs,
  parseMeetInfo,
  parseRankingsTable,
  RANKINGS_PAGE_URL,
  type IntlRanking,
  type MeetInfo,
} from './parse/intlRankings';

/**
 * USAW international squad standings (port of `intl_rankings_scraper.py
 * --all`): every rankings PDF behind a "View" button on the standings page,
 * each synced as one (meet, gender, age) group. Groups no longer on the page
 * are pruned, but only when every PDF was stored, as before. A PDF whose
 * group cannot be named (no age category in its title or text) counts as a
 * failure and the run reports it.
 */
type GroupResult = { meet: string; gender: string; ageCategory: string; inserted: number; updated: number; unchanged: number; deleted: number; pruned: boolean };
type ParsedPdf = { title: string; url: string; info: MeetInfo; rankings: IntlRanking[] };
type RunResult = { pdfs: ParsedPdf[]; groups: GroupResult[]; failed: string[] };

export const run = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }): Promise<RunResult> => {
    const pdfs: ParsedPdf[] = [];
    for (const { title, url } of discoverRankingPdfs(await fetchText(RANKINGS_PAGE_URL, 60_000))) {
      const lines = (await pdfLines(await fetchBytes(url, 60_000))).flat();
      const info = parseMeetInfo(lines, title, url);
      pdfs.push({ title, url, info, rankings: parseRankingsTable(lines, info) });
    }
    if (pdfs.length === 0) throw new Error('intl rankings: no PDFs on the standings page');
    if (dryRun) return { pdfs, groups: [], failed: [] };

    const groups: GroupResult[] = [];
    const failed: string[] = [];
    for (const pdf of pdfs) {
      const { meet_name: meet, gender, age_category: ageCategory } = pdf.info;
      if (!pdf.rankings.length || !meet || !gender || !ageCategory) {
        failed.push(`${pdf.title} (${pdf.rankings.length} rows; meet=${meet} gender=${gender} age=${ageCategory})`);
        continue;
      }
      const counts: Omit<GroupResult, 'meet' | 'gender' | 'ageCategory' | 'pruned'> = await ctx.runMutation(
        internal.ingest.replaceIntlRankingsGroup,
        {
          meet,
          gender,
          ageCategory,
          rankings: pdf.rankings.map((r) => ({
            ranking: r.ranking,
            name: r.name,
            weightClass: r.weight_class,
            total: r.total ?? undefined,
            percentA: r.percent_a ?? undefined,
          })),
        },
      );
      groups.push({ meet, gender, ageCategory, ...counts, pruned: false });
    }
    if (failed.length === 0 && groups.length > 0) {
      const pruned: { deletedGroups: { meet: string; gender: string; ageCategory: string; deleted: number }[] } =
        await ctx.runMutation(internal.ingest.deleteMissingIntlRankingGroups, {
          groups: groups.map(({ meet, gender, ageCategory }) => ({ meet, gender, ageCategory })),
        });
      for (const g of pruned.deletedGroups) groups.push({ ...g, inserted: 0, updated: 0, unchanged: 0, pruned: true });
    }
    if (failed.length) {
      // Everything storable is stored; failing the run (the VPS job exited 1)
      // is what surfaces the skipped PDFs in the Convex logs.
      throw new Error(`intl rankings: ${failed.length} PDF(s) not stored, stale groups not pruned: ${failed.join('; ')}`);
    }
    return { pdfs, groups, failed };
  },
});
