import { devLog } from '@/lib/logger';
import type { SupabaseLiftResult } from '@/types/athlete-results';

/**
 * One load of an athlete's results screen: the on-device copy as a fast first
 * paint, then the full history from the API, which replaces it.
 *
 * The API request goes out *before* the on-device read. That read is not
 * cheap for an athlete with no stored history (anyone opened from search):
 * `getAllCachedLiftingResultsForAthlete` then inflates and parses the stored
 * results of every downloaded meet to look for the name. Measured in Jest with
 * two 1,600-row meets, 4 storage reads and ~26 ms under Node's JIT (roughly
 * 5x that on an interpreter such as Hermes) sat in front of the request, which
 * only started once the scan found nothing. Now the scan runs while the
 * request is in flight.
 *
 * What gets painted is unchanged: the on-device rows (when there are any and
 * nothing was shown yet), then the API rows, which never replace shown rows
 * with an empty answer.
 */
export type AthleteResultsLoad = {
  /** Rows this screen already holds for the athlete (its in-memory copy). */
  shown: readonly SupabaseLiftResult[] | undefined;
  readOffline: () => Promise<SupabaseLiftResult[]>;
  fetchFull: () => Promise<SupabaseLiftResult[]>;
  /** False once the screen moved on (another athlete, or unmounted). */
  isCurrent: () => boolean;
  /** Paint rows. `api` rows are the complete history and may be memoized. */
  show: (rows: SupabaseLiftResult[], source: 'offline' | 'api') => void;
};

type FullOutcome =
  | { ok: true; rows: SupabaseLiftResult[] }
  | { ok: false; error: unknown };

/**
 * How a load ended: `shown` once the screen has something it can trust
 * (rows, or the API's own empty answer), `failed` when the request failed
 * with nothing on screen (offline, or an error: not "this athlete has no
 * results"), `superseded` when the screen moved on.
 */
export type AthleteResultsOutcome = 'shown' | 'failed' | 'superseded';

export async function loadAthleteResults(
  load: AthleteResultsLoad,
): Promise<AthleteResultsOutcome> {
  // Started first and settled into a value, so a rejection while the
  // on-device read is still running is never unhandled.
  const full: Promise<FullOutcome> = load.fetchFull().then(
    (rows) => ({ ok: true, rows }),
    (error: unknown) => ({ ok: false, error }),
  );

  let displayedCount = load.shown?.length ?? 0;
  if (displayedCount === 0) {
    try {
      const offline = await load.readOffline();
      if (!load.isCurrent()) return 'superseded';
      if (offline.length > 0) {
        displayedCount = offline.length;
        load.show(offline, 'offline');
      }
    } catch (cacheError) {
      devLog(`Cache miss for athlete results, fetching from API ${cacheError}`);
    }
  }

  const outcome = await full;
  if (!load.isCurrent()) return 'superseded';
  if (outcome.ok) {
    // An empty answer (e.g. a transient name-normalization miss) must not
    // clobber rows already on screen.
    if (outcome.rows.length > 0 || displayedCount === 0) {
      load.show(outcome.rows, 'api');
    }
    return 'shown';
  }
  if (displayedCount > 0) {
    // Offline or the request failed: whatever was shown stays.
    return 'shown';
  }
  console.error('Error fetching athlete results:', outcome.error);
  return 'failed';
}
