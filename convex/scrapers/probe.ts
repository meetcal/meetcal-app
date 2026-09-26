import { v } from 'convex/values';
import { internalAction } from '../_generated/server';

/** Fetches a URL from Convex's servers and reports status and size (scraper reachability checks). */
export const fetchStatus = internalAction({
  args: { url: v.string() },
  handler: async (_ctx, { url }) => {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    const text = await response.text();
    return { status: response.status, bytes: text.length, head: text.slice(0, 200) };
  },
});
