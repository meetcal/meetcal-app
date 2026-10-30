/** Fetch helpers for the scrapers: a browser User-Agent, a timeout, and a status check. */
export const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const DEFAULT_TIMEOUT_MS = 30_000;

async function get(url: string, timeoutMs: number, headers: Record<string, string> = {}): Promise<Response> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new HttpStatusError(url, response.status);
  return response;
}

/** A response with an error status, which keeps the status for `throttledOrTransient`. */
export class HttpStatusError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`GET ${url} failed with ${status}`);
    this.name = 'HttpStatusError';
  }
}

/** A JSON body, unchecked (`unknown`: the caller reads it); `headers` add to or replace the defaults. */
export async function fetchJson(url: string, { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {} }: { timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<unknown> {
  return (await (await get(url, timeoutMs, { accept: 'application/json', ...headers })).json()) as unknown;
}

export async function fetchText(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  return await (await get(url, timeoutMs)).text();
}

export async function fetchBytes(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Uint8Array> {
  return new Uint8Array(await (await get(url, timeoutMs)).arrayBuffer());
}

/** How far into a file its "%PDF-" header may be: readers look this far. */
const PDF_HEADER_WINDOW = 1024;

/**
 * A PDF's bytes. A body that is not a PDF (no "%PDF-" in its first
 * `PDF_HEADER_WINDOW` bytes) throws: a site that refuses a scraper with an
 * HTML page at status 200 must fail the source, not parse as an empty file.
 */
export async function fetchPdf(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Uint8Array> {
  const response = await get(url, timeoutMs, { accept: 'application/pdf' });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.length, PDF_HEADER_WINDOW)).includes('%PDF-')) {
    throw new Error(`GET ${url} returned ${response.headers.get('content-type') ?? 'no content type'}, not a PDF (${bytes.length} bytes)`);
  }
  return bytes;
}

/** Resolves a link found on a page against that page's URL. */
export function absoluteUrl(href: string, base: string): string {
  return new URL(href, base).toString();
}

const TRANSIENT_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET']);

/**
 * Whether a failed request is worth repeating: a timeout, or a socket or DNS
 * failure. Certificate errors and HTTP errors stay failures, rather than
 * weakening validation.
 */
export function retryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'TimeoutError') return true;
  // Node fetch wraps socket/DNS failures in a TypeError.
  const cause = 'cause' in error ? error.cause : undefined;
  if (error instanceof TypeError && cause instanceof Error && 'code' in cause) {
    return TRANSIENT_CODES.has(String(cause.code));
  }
  return false;
}

/**
 * `retryable`, or a server asking us to slow down (429) or failing on its
 * side (5xx): Google answers a burst of sheet requests with 429. Other
 * statuses (a 404 for a deleted tab) stay failures.
 */
export function throttledOrTransient(error: unknown): boolean {
  if (error instanceof HttpStatusError) return error.status === 429 || error.status >= 500;
  return retryable(error);
}

export type RetryPolicy = {
  /** Tries in all, the first included. */
  attempts: number;
  /** The wait before the try after `attempt` failed. */
  delayMs: (attempt: number) => number;
  /** Whether a failure is worth another try (every failure when absent). */
  retryIf?: (error: unknown) => boolean;
};

/**
 * `run` until it succeeds or the policy gives up; then the last failure, or
 * what `giveUp` makes of it and the number of tries, is thrown.
 */
export async function withRetries<T>(
  run: () => Promise<T>,
  { attempts, delayMs, retryIf = () => true }: RetryPolicy,
  giveUp: (error: unknown, attempts: number) => unknown = (error) => error,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= attempts || !retryIf(error)) throw giveUp(error, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs(attempt)));
    }
  }
}

/**
 * `run` over `items`, at most `limit` at a time, the answers in `items`'
 * order. A failure starts no new calls and, once the calls already started
 * have finished, rejects with it.
 */
export async function mapLimited<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  if (!(limit >= 1)) throw new Error(`mapLimited: limit must be at least 1, got ${limit}`);
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        results[i] = await run(items[i]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  const settled = await Promise.allSettled(workers);
  const failure = settled.find((outcome) => outcome.status === 'rejected');
  if (failure) throw failure.reason;
  return results;
}
