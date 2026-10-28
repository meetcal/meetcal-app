import { HttpStatusError } from './http';

/**
 * Pages behind a bot challenge (iwf.sport's Cloudflare one), loaded in a
 * real browser by Browserless's `/unblock` API, which answers with the page's
 * HTML once the challenge has passed. The token (`BROWSERLESS_TOKEN`, a
 * Convex environment variable) goes in the Authorization header, never the
 * URL, so it stays out of errors, logs and alert emails.
 */
export const UNBLOCK_URL = 'https://production-sfo.browserless.io/unblock';

/**
 * Browserless turned the request down for the account's plan: no units left
 * (the free tier has 1,000 a month), a payment problem (402), or 429, which
 * it answers when the plan's browsers are all busy (tried again first,
 * `IWF_RETRY`). Its documentation names no quota status, so a 401 or 403
 * counts only when the body says it is about the plan; an invalid key is
 * not.
 */
export class BrowserlessQuotaError extends HttpStatusError {
  constructor(
    status: number,
    readonly detail: string,
  ) {
    super(UNBLOCK_URL, status);
    this.name = 'BrowserlessQuotaError';
    this.message = `Browserless refused for the plan (${status}): ${detail}`;
  }
}

/**
 * Browserless refused the token (401 or 403 not about the plan): it is wrong,
 * revoked or rotated, and needs fixing by hand, so the IWF run reports it
 * (`scrapers/iwfRecords.ts`).
 */
export class BrowserlessKeyError extends HttpStatusError {
  constructor(
    status: number,
    readonly detail: string,
  ) {
    super(UNBLOCK_URL, status);
    this.name = 'BrowserlessKeyError';
    this.message = `Browserless refused the token (${status}): ${detail}`;
  }
}

const QUOTA_TEXT = /quota|units?\b|usage|limit|exceed|payment|billing|plan\b|subscription|credit|upgrade/i;

/** Whether a refusal with `status` and `body` is about the account's plan rather than the request. */
export function isQuotaRefusal(status: number, body: string): boolean {
  if (status === 402 || status === 429) return true;
  return (status === 401 || status === 403) && QUOTA_TEXT.test(body);
}

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
  if (!response.ok) {
    const body = (await response.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 200);
    if (isQuotaRefusal(response.status, body)) throw new BrowserlessQuotaError(response.status, body);
    if (response.status === 401 || response.status === 403) throw new BrowserlessKeyError(response.status, body);
    throw new HttpStatusError(UNBLOCK_URL, response.status);
  }
  const body: unknown = await response.json();
  const content = typeof body === 'object' && body !== null && 'content' in body ? body.content : undefined;
  if (typeof content !== 'string' || content.length === 0) throw new Error(`Browserless ${url}: no content`);
  if (/<title>\s*Just a moment/i.test(content)) throw new ChallengeError(url);
  return content;
}
