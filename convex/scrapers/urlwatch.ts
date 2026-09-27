'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { unifiedDiff } from './lib/diff';
import { escapeHtml, sendEmail } from './lib/email';
import { fetchText } from './lib/http';
import { pageText, WATCHED_PAGES } from './parse/watchedPages';

/**
 * urlwatch, hourly (replaces the VPS's `urlwatch` job): each watched page's
 * text is compared with the last run's, and the run's changes are emailed
 * (OneSignal, to `URLWATCH_EMAIL`) as diffs in one message. A page seen for
 * the first time is only recorded. A page that stops loading, or whose
 * selector stops matching (a redesign), is reported once, when it starts
 * failing, and its last text is kept. Snapshots are saved only after the
 * email went out, so a failed send is retried the next hour.
 */
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
        text = pageText(await fetchText(page.url, 30_000), page.selector);
        if (!text) throw new Error(`"${page.selector}" matched nothing`);
      } catch (error) {
        const result: PageResult = { name: page.name, url: page.url, status: 'error', error: (error as Error).message };
        results.push(result);
        if (!previous?.error) report.push(result);
        saves.push({ url: page.url, error: result.error });
        continue;
      }
      let result: PageResult;
      if (!previous) result = { name: page.name, url: page.url, status: 'new' };
      else if (previous.text === text) result = { name: page.name, url: page.url, status: 'unchanged' };
      else {
        result = { name: page.name, url: page.url, status: 'changed', diff: unifiedDiff(previous.text, text) };
        report.push(result);
      }
      results.push(result);
      saves.push({ url: page.url, text });
    }
    if (dryRun) return results;
    if (report.length) {
      const to = process.env.URLWATCH_EMAIL;
      if (!to) throw new Error('urlwatch: URLWATCH_EMAIL is not set; not saving, so the changes are reported once it is');
      const changed = report.filter((r) => r.status === 'changed').length;
      const subject = changed ? `urlwatch: ${report.map((r) => r.name.replace('USA Masters Weightlifting ', '')).join(', ')} changed` : `urlwatch: ${report[0].name} failed`;
      await sendEmail(to, subject, emailBody(report));
    }
    for (const save of saves) await ctx.runMutation(internal.scrapers.watchedPageState.save, save);
    return results;
  },
});
