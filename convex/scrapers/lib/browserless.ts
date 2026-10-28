import { HttpStatusError } from './http';

/**
 * Pages behind a bot challenge (iwf.sport's Cloudflare one), loaded in a
 * real browser by Browserless's `/unblock` API, which answers with the page's
 * HTML once the challenge has passed. The token (`BROWSERLESS_TOKEN`, a
 * Convex environment variable) goes in the Authorization header, never the
 * URL, so it stays out of errors, logs and alert emails.
 */
export const UNBLOCK_URL = 'https://production-sfo.browserless.io/unblock';

/** The HTML still is the challenge ("Just a moment..."), not the page. */
export class ChallengeError extends Error {
  constructor(readonly url: string) {
    super(`${url} still showed the bot challenge`);
    this.name = 'ChallengeError';
  }
}

export async function fetchUnblockedHtml(url: string, token: string, timeoutMs: number): Promise<string> {
  if (!token) throw new Error('fetchUnblockedHtml: empty Browserless token');
  const response = await fetch(UNBLOCK_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    // Only the HTML: cookies, a screenshot and a live browser cost time.
    body: JSON.stringify({ url, content: true, cookies: false, screenshot: false, browserWSEndpoint: false }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new HttpStatusError(UNBLOCK_URL, response.status);
  const body: unknown = await response.json();
  const content = typeof body === 'object' && body !== null && 'content' in body ? body.content : undefined;
  if (typeof content !== 'string' || content.length === 0) throw new Error(`Browserless ${url}: no content`);
  if (/<title>\s*Just a moment/i.test(content)) throw new ChallengeError(url);
  return content;
}
