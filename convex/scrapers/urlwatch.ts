'use node';

import { errorMessage, itemAt } from '../lib/json';
import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { unifiedDiff } from './lib/diff';
import { escapeHtml, sendEmail } from '../lib/email';
import { fetchPageText } from './lib/incompleteChain';
import { pageChange, pageText, reportDelivery, WATCHED_PAGES } from './parse/watchedPages';

type PageResult = { name: string; url: string; status: 'new' | 'unchanged' | 'changed' | 'error'; error?: string; diff?: string };

const MAX_DIFF = 60_000;

function emailBody(results: PageResult[]): string {
  const sections = results.map((r) => {
    const heading = `<h3 style="margin:16px 0 4px">${escapeHtml(r.name)}${r.status === 'error' ? ' (error)' : ''}</h3><a href="${escapeHtml(r.url)}">${escapeHtml(r.url)}</a>`;
    if (r.status === 'error') return `${heading}<p>${escapeHtml(r.error ?? '')}</p>`;
    const diff = (r.diff ?? '').length > MAX_DIFF ? `${r.diff!.slice(0, MAX_DIFF)}\n… (diff truncated)` : (r.diff ?? '');
    const lines = diff
      .split('\n')
      .map((line) => {
        const colour = line.startsWith('+') ? '#1a7f37' : line.startsWith('-') ? '#cf222e' : line.startsWith('@@') ? '#6e7781' : '#24292f';
        return `<span style="color:${colour}">${escapeHtml(line)}</span>`;
      })
      .join('\n');
    return `${heading}<pre style="font-size:13px;background:#f6f8fa;padding:8px;white-space:pre-wrap">${lines}</pre>`;
  });
  return `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif">${sections.join('')}</div>`;
}

export const run = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }): Promise<PageResult[]> => {
    const results: PageResult[] = [];
    const saves: { url: string; text?: string; error?: string }[] = [];
    const report: PageResult[] = [];
    for (const page of WATCHED_PAGES) {
      const previous = await ctx.runQuery(internal.scrapers.watchedPageState.get, { url: page.url });
      let text: string;
      try {
        text = pageText(await fetchPageText(page.url, 30_000), page.selector, { pdfLinks: page.pdfLinks });
        if (!text) throw new Error(`"${page.selector}" matched nothing`);
      } catch (error) {
        const result: PageResult = { name: page.name, url: page.url, status: 'error', error: errorMessage(error) };
        results.push(result);
        if (!previous?.error) report.push(result);
        saves.push({ url: page.url, error: result.error });
        continue;
      }
      const status = pageChange(previous, text);
      const result: PageResult = { name: page.name, url: page.url, status };
      if (status === 'changed') {
        result.diff = unifiedDiff(previous!.text, text);
        report.push(result);
      }
      results.push(result);
      saves.push({ url: page.url, text });
    }
    if (dryRun) return results;
    if (report.length) {
      const delivery = reportDelivery({ URLWATCH_EMAIL: process.env.URLWATCH_EMAIL, ALERT_EMAIL: process.env.ALERT_EMAIL });
      if (delivery === 'fail') throw new Error('urlwatch: URLWATCH_EMAIL is not set; not saving, so the changes are reported once it is');
      const changed = report.filter((r) => r.status === 'changed').length;
      const subject = changed ? `urlwatch: ${report.map((r) => r.name.replace('USA Masters Weightlifting ', '')).join(', ')} changed` : `urlwatch: ${itemAt(report, 0).name} failed`;
      if (delivery === 'send') await sendEmail(process.env.URLWATCH_EMAIL!, subject, emailBody(report));
      else for (const r of report) console.warn(`${subject}: ${r.name} (${r.url}) ${r.status}${r.error ? `: ${r.error}` : ''}`);
    }
    for (const save of saves) await ctx.runMutation(internal.scrapers.watchedPageState.save, save);
    return results;
  },
});
