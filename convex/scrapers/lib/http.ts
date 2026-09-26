/** Fetch helpers for the scrapers: a browser User-Agent, a timeout, and a status check. */
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const DEFAULT_TIMEOUT_MS = 30_000;

async function get(url: string, timeoutMs: number): Promise<Response> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`);
  return response;
}

export async function fetchText(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  return await (await get(url, timeoutMs)).text();
}

export async function fetchBytes(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Uint8Array> {
  return new Uint8Array(await (await get(url, timeoutMs)).arrayBuffer());
}

/** Resolves a link found on a page against that page's URL. */
export function absoluteUrl(href: string, base: string): string {
  return new URL(href, base).toString();
}
