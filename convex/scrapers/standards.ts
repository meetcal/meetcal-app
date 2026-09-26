'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchBytes, fetchText } from './lib/http';
import { findStandardsPdfUrl, parseStandards, type Standard } from './parse/standards';
import { pdfLines } from './lib/pdf';
import { postSlack } from './lib/slack';

/**
 * USA Weightlifting A/B standards (port of `usaw/standards_scraper`): finds
 * the "Standards" PDF on the selection procedures page, reads each section
 * ("Senior Women's A Standards", then a `Category` line of weight classes and
 * a `Total` line of values) and upserts every (age, gender, class) row.
 * Later pages win for a class listed twice (current and upcoming categories).
 */
const PAGE_URL = 'https://www.usaweightlifting.org/resources/athlete-information-and-programs/selection-procedures';

function slackMessage(inserted: Standard[], updated: Standard[]): string {
  let message = `USA Weightlifting Standards Update\n*${inserted.length}* new standards inserted, *${updated.length}* standards updated`;
  const list = (rows: Standard[], withValues: boolean) =>
    rows
      .slice(0, 10)
      .map((r) => `• ${r.age_category} ${r.gender} ${r.weight_class}${withValues ? ` (A=${r.standard_a}, B=${r.standard_b})` : ''}`)
      .join('\n') + (rows.length > 10 ? `\n... and ${rows.length - 10} more` : '');
  if (inserted.length) message += `\n\n*New Standards (${inserted.length}):*\n${list(inserted, true)}`;
  if (updated.length) message += `\n\n*Updated Standards (${updated.length}):*\n${list(updated, false)}`;
  return message;
}

type RunResult = { pdfUrl: string; standards: Standard[]; inserted: number; updated: number };

export const run = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }): Promise<RunResult> => {
    const pdfUrl = findStandardsPdfUrl(await fetchText(PAGE_URL), PAGE_URL);
    if (!pdfUrl) throw new Error('standards: no standards PDF link on the selection procedures page');
    const standards = parseStandards(await pdfLines(await fetchBytes(pdfUrl)));
    if (standards.length === 0) throw new Error(`standards: nothing parsed from ${pdfUrl}`);
    if (dryRun) return { pdfUrl, standards, inserted: 0, updated: 0 };

    const outcomes: { wasInsert: boolean; wasChanged: boolean }[] = await ctx.runMutation(internal.ingest.upsertStandards, {
      rows: standards.map((s) => ({
        ageCategory: s.age_category,
        gender: s.gender,
        weightClass: s.weight_class,
        standardA: s.standard_a,
        standardB: s.standard_b,
      })),
    });
    const inserted = standards.filter((_, i) => outcomes[i].wasInsert);
    const updated = standards.filter((_, i) => !outcomes[i].wasInsert && outcomes[i].wasChanged);
    console.log(`standards: ${standards.length} parsed, ${inserted.length} inserted, ${updated.length} updated`);
    if (inserted.length || updated.length) await postSlack(process.env.SLACK_STANDARDS_WEBHOOK_URL, 'standards', slackMessage(inserted, updated));
    return { pdfUrl, standards, inserted: inserted.length, updated: updated.length };
  },
});
