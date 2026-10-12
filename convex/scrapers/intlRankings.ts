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
import { sourcesFailed, type SourceFailure } from '../lib/cronAlerts';

/**
 * USAW international squad standings (port of `intl_rankings_scraper.py
 * --all`): every rankings PDF behind a "View" button on the standings page,
 * each synced as one (meet, gender, age) group. A PDF that fails to
 * download, parse or store, or whose group cannot be named (no age category
 * in its title or text), is skipped and the rest stored; the run then fails
 * naming it. Groups no longer on the page are pruned, but only when every PDF was
 * stored, as before, and only so many at once (`deleteMissingIntlRankingGroups`):
 * a card whose wording changed drops off the page like a retired group.
 */
type GroupResult = { meet: string; gender: string; ageCategory: string; inserted: number; updated: number; unchanged: number; deleted: number; pruned: boolean };
type ParsedPdf = { title: string; url: string; info: MeetInfo; rankings: IntlRanking[] };
type RunResult = { pdfs: ParsedPdf[]; groups: GroupResult[]; failed: string[] };

export const run = internalAction({
  // `allowShrink`: let the prune delete more groups than it otherwise may
  // (the standings page really retired them), after checking the page by hand.
  args: { dryRun: v.optional(v.boolean()), allowShrink: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun, allowShrink }): Promise<RunResult> => {
    const pdfs: ParsedPdf[] = [];
    // Everything not stored, by PDF title. The rest is still stored, then the
    // run fails naming these, so the alert fires and the next run retries.
    const failures: SourceFailure[] = [];
    const listed = discoverRankingPdfs(await fetchText(RANKINGS_PAGE_URL, 60_000));
    if (listed.length === 0) throw new Error('intl rankings: no PDFs on the standings page');
    for (const { title, url } of listed) {
      try {
        const lines = (await pdfLines(await fetchBytes(url, 60_000))).flat();
        const info = parseMeetInfo(lines, title, url);
        pdfs.push({ title, url, info, rankings: parseRankingsTable(lines, info) });
      } catch (error) {
        failures.push({ source: title, error: `${url}: ${(error as Error).message}` });
      }
    }
    const failed = () => failures.map(({ source, error }) => `${source}: ${error}`);
    if (dryRun) return { pdfs, groups: [], failed: failed() };

    const groups: GroupResult[] = [];
    for (const pdf of pdfs) {
      const { meet_name: meet, gender, age_category: ageCategory } = pdf.info;
      if (!pdf.rankings.length || !meet || !gender || !ageCategory) {
        failures.push({ source: pdf.title, error: `${pdf.rankings.length} rows; meet=${meet} gender=${gender} age=${ageCategory}` });
        continue;
      }
      // A group that fails to store (a row repeated in the PDF, a transient
      // error) is one failed PDF like an unreadable one: the rest are stored.
      let counts: Omit<GroupResult, 'meet' | 'gender' | 'ageCategory' | 'pruned'>;
      try {
        counts = await ctx.runMutation(internal.ingest.replaceIntlRankingsGroup, {
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
        });
      } catch (error) {
        failures.push({ source: pdf.title, error: `${pdf.url}: not stored: ${(error as Error).message}` });
        continue;
      }
      groups.push({ meet, gender, ageCategory, ...counts, pruned: false });
    }
    if (failures.length === 0 && groups.length > 0) {
      const pruned: { deletedGroups: { meet: string; gender: string; ageCategory: string; deleted: number }[] } =
        await ctx.runMutation(internal.ingest.deleteMissingIntlRankingGroups, {
          groups: groups.map(({ meet, gender, ageCategory }) => ({ meet, gender, ageCategory })),
          allowShrink: allowShrink ?? false,
        });
      for (const g of pruned.deletedGroups) groups.push({ ...g, inserted: 0, updated: 0, unchanged: 0, pruned: true });
    }
    if (failures.length) {
      // Everything storable is stored; failing the run (the VPS job exited 1)
      // is what surfaces the skipped PDFs, and alerts.
      throw sourcesFailed(`intl rankings: ${failures.length} PDF(s) not stored, stale groups not pruned`, failures);
    }
    return { pdfs, groups, failed: failed() };
  },
});
