
import { fetchPdf, fetchText, retryable, withRetries, type RetryPolicy } from './http';
import { errorMessage } from '../../lib/errors';

/**
 * The WSO sites on small hosts (Missouri Valley, Mountain South, Illinois,
 * New York, New England) now and then reset a connection or time out before
 * answering: Mountain South's "fetch failed" of 4 November 2026 was one. A
 * request is tried 3 times, 1 and then 2 seconds apart. Certificate errors,
 * HTTP errors and a body that is not a PDF fail at once (`retryable`).
 */
export const TRANSIENT_RETRY: RetryPolicy = { attempts: 3, delayMs: (attempt) => 1_000 * attempt, retryIf: retryable };

export function gaveUp(url: string, method = 'GET') {
  return (error: unknown, attempts: number) => {
    const cause = error instanceof Error && 'cause' in error ? error.cause : undefined;
    const detail = cause instanceof Error
      ? ` (${('code' in cause ? `${String(cause.code)}: ` : '')}${cause.message})`
      : '';
    return Object.assign(new Error(`${method} ${url} failed after ${attempts} attempt(s): ${errorMessage(error)}${detail}`), { cause: error });
  };
}

/** A page's text, retried on a transient failure (`TRANSIENT_RETRY`). */
export async function fetchTextRetrying(url: string, timeoutMs?: number): Promise<string> {
  return await withRetries(() => fetchText(url, timeoutMs), TRANSIENT_RETRY, gaveUp(url));
}

/** A PDF's bytes, retried on a transient failure (`TRANSIENT_RETRY`). */
export async function fetchPdfRetrying(url: string, timeoutMs?: number): Promise<Uint8Array> {
  return await withRetries(() => fetchPdf(url, timeoutMs), TRANSIENT_RETRY, gaveUp(url));
}
