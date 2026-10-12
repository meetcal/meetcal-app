import { fetchText, retryable, withRetries } from './http';
import { MISSOURI_VALLEY_URL } from '../parse/wso/missouriValley';

const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 45_000;
const RETRY_DELAY_MS = 1_000;

/** This origin intermittently resets or times out before serving its records. */
export async function fetchMissouriValleyPage(): Promise<string> {
  return await withRetries(
    () => fetchText(MISSOURI_VALLEY_URL, REQUEST_TIMEOUT_MS),
    { attempts: MAX_ATTEMPTS, delayMs: (attempt) => RETRY_DELAY_MS * attempt, retryIf: retryable },
    (error, attempts) => {
      const cause = error instanceof Error && 'cause' in error ? error.cause : undefined;
      const detail = cause instanceof Error
        ? ` (${('code' in cause ? `${String(cause.code)}: ` : '')}${cause.message})`
        : '';
      return Object.assign(new Error(`GET ${MISSOURI_VALLEY_URL} failed after ${attempts} attempt(s): ${error instanceof Error ? error.message : String(error)}${detail}`), { cause: error });
    },
  );
}
