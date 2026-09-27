'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { unifiedDiff } from './lib/diff';
import { fetchText } from './lib/http';
import { postSlack } from './lib/slack';
import { pageText, WATCHED_PAGES } from './parse/watchedPages';

/**
 * urlwatch, hourly (replaces the VPS's `urlwatch` job): each watched page's
 * text is compared with the last run's, and a change is posted to Slack as a
 * diff. A page seen for the first time is only recorded. A page that stops
 * loading, or whose selector stops matching (a redesign), is posted once
 * when it starts failing, not every hour, and its last text is kept.
 */
type PageResult = { name: string; status: 'new' | 'unchanged' | 'changed' | 'error'; error?: string; diff?: string };

const SLACK_LIMIT = 3500;

export const run = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }): Promise<PageResult[]> => {
    const results: PageResult[] = [];
    const webhook = process.env.SLACK_URLWATCH_WEBHOOK_URL;
    for (const page of WATCHED_PAGES) {
      const previous = await ctx.runQuery(internal.scrapers.watchedPageState.get, { url: page.url });
      let text: string;
      try {
        text = pageText(await fetchText(page.url, 30_000), page.selector);
        if (!text) throw new Error(`"${page.selector}" matched nothing`);
      } catch (error) {
        const message = (error as Error).message;
        results.push({ name: page.name, status: 'error', error: message });
        if (dryRun) continue;
        if (!previous?.error) await postSlack(webhook, 'urlwatch', `*urlwatch: ERROR* ${page.name} (${page.url})\n${message}`);
        await ctx.runMutation(internal.scrapers.watchedPageState.save, { url: page.url, error: message });
        continue;
      }
      if (!previous) {
        results.push({ name: page.name, status: 'new' });
      } else if (previous.text === text) {
        results.push({ name: page.name, status: 'unchanged' });
      } else {
        const diff = unifiedDiff(previous.text, text);
        results.push({ name: page.name, status: 'changed', diff });
        const body = diff.length > SLACK_LIMIT ? `${diff.slice(0, SLACK_LIMIT)}\n… (diff truncated)` : diff;
        if (!dryRun) await postSlack(webhook, 'urlwatch', `*urlwatch: CHANGED* ${page.name} (${page.url})\n\`\`\`\n${body}\n\`\`\``);
      }
      if (!dryRun) await ctx.runMutation(internal.scrapers.watchedPageState.save, { url: page.url, text });
    }
    return results;
  },
});
