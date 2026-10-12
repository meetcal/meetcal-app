/** Fetch helpers for the scrapers: a browser User-Agent, a timeout, and a status check. */
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const DEFAULT_TIMEOUT_MS = 30_000;

async function get(url: string, timeoutMs: number, headers: Record<string, string> = {}): Promise<Response> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`);
  return response;
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
