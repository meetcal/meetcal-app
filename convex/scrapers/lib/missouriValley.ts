import { fetchText } from './http';
import { MISSOURI_VALLEY_URL } from '../parse/wso/missouriValley';

const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 45_000;
const RETRY_DELAY_MS = 1_000;
const TRANSIENT_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET']);

function retryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'TimeoutError') return true;
  // Node fetch wraps socket/DNS failures in a TypeError. Certificate errors
  // and HTTP errors must remain failures, rather than weakening validation.
  const cause = 'cause' in error ? error.cause : undefined;
  if (error instanceof TypeError && cause instanceof Error && 'code' in cause) {
    return TRANSIENT_CODES.has(String(cause.code));
  }
  return false;
}

/** This origin intermittently resets or times out before serving its records. */
export async function fetchMissouriValleyPage(): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchText(MISSOURI_VALLEY_URL, REQUEST_TIMEOUT_MS);
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !retryable(error)) {
        const cause = error instanceof Error && 'cause' in error ? error.cause : undefined;
        const detail = cause instanceof Error
          ? ` (${('code' in cause ? `${String(cause.code)}: ` : '')}${cause.message})`
          : '';
        throw Object.assign(new Error(`GET ${MISSOURI_VALLEY_URL} failed after ${attempt} attempt(s): ${error instanceof Error ? error.message : String(error)}${detail}`), { cause: error });
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
  }
}
