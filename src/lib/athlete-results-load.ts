import { devLog } from '@/lib/logger';
import type { AthleteLookup, LifterCard, PRIndexes } from '@/data/types/athletes';
import type { AthleteMeetResult } from '@/types/athlete-results';

export type AthleteChoice = Extract<AthleteLookup, { kind: 'choose' }>;

export type ApiDetails = { lifter: LifterCard | null; prs: PRIndexes };

export type SavedResults = { rows: AthleteMeetResult[]; details: ApiDetails | null };

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
  shown: readonly AthleteMeetResult[] | undefined;
  shownSource?: ShownResultsSource;
  readOffline: () => Promise<AthleteMeetResult[]>;
  readBrowsed?: () => Promise<SavedResults | null>;
  rememberFull?: (rows: AthleteMeetResult[], details: ApiDetails) => Promise<void>;
  fetchFull: () => Promise<AthleteLookup>;
  isCurrent: () => boolean;
  show: (rows: AthleteMeetResult[], source: ShownResultsSource, details: ApiDetails | null) => void;
  choose: (choice: AthleteChoice) => void;
};

type FullOutcome =
  | { ok: true; answer: AthleteLookup }
  | { ok: false; error: unknown };

export type AthleteResultsOutcome = 'shown' | 'offline-partial' | 'kept-stale' | 'failed' | 'superseded';

export type ShownResultsSource = 'offline' | 'saved' | 'api';

export function showsCareerStats(source: ShownResultsSource | null): boolean {
  return source === 'api' || source === 'saved';
}

export function canRetryFullHistory(outcome: AthleteResultsOutcome | null): boolean {
  return outcome === 'offline-partial' || outcome === 'kept-stale' || outcome === 'failed';
}

export function partialResultsStatus(input: {
  source: ShownResultsSource | null;
  outcome: AthleteResultsOutcome | null;
  isOffline: boolean;
}): string | null {
  const reason = input.isOffline ? 'Offline.' : 'Full history unavailable.';
  if (input.source === 'saved') {
    return input.outcome === 'kept-stale' ? `${reason} Showing the history saved on this device, which may be out of date.` : null;
  }
  if (input.source !== 'offline') return null;
  if (input.outcome === null) return 'Loading full history…';
  return `${reason} Showing downloaded data. PRs and success rates appear once the full history loads.`;
}

function keptOutcome(source: ShownResultsSource | null): AthleteResultsOutcome {
  if (source === 'offline') return 'offline-partial';
  if (source === 'saved') return 'kept-stale';
  return 'shown';
}

export async function loadAthleteResults(
  load: AthleteResultsLoad,
): Promise<AthleteResultsOutcome> {
  // Started first and settled into a value, so a rejection while the
  // on-device read is still running is never unhandled.
  const full: Promise<FullOutcome> = load.fetchFull().then(
    (answer) => ({ ok: true, answer }),
    (error: unknown) => ({ ok: false, error }),
  );

  let displayedCount = load.shown?.length ?? 0;
  let displayedSource: ShownResultsSource | null = displayedCount > 0 ? (load.shownSource ?? 'api') : null;
  if (displayedCount === 0 && load.readBrowsed) {
    const browsed = await load.readBrowsed().catch(() => null);
    if (!load.isCurrent()) return 'superseded';
    if (browsed && browsed.rows.length > 0) {
      displayedCount = browsed.rows.length;
      displayedSource = 'saved';
      load.show(browsed.rows, 'saved', browsed.details);
    }
  }
  if (displayedCount === 0) {
    try {
      const offline = await load.readOffline();
      if (!load.isCurrent()) return 'superseded';
      if (offline.length > 0) {
        displayedCount = offline.length;
        displayedSource = 'offline';
        load.show(offline, 'offline', null);
      }
    } catch (cacheError) {
      devLog(`Cache miss for athlete results, fetching from API ${cacheError}`);
    }
  }

  const outcome = await full;
  if (!load.isCurrent()) return 'superseded';
  if (outcome.ok) {
    const { answer } = outcome;
    if (answer.kind === 'choose') {
      load.choose(answer);
      return 'shown';
    }
    if (answer.rows.length > 0 || displayedCount === 0) {
      const details = { lifter: answer.lifter, prs: answer.prs };
      load.show(answer.rows, 'api', details);
      if (answer.rows.length > 0) {
        load.rememberFull?.(answer.rows, details).catch((error: unknown) => {
          console.warn('Could not keep the athlete results for offline', error);
        });
      }
      return 'shown';
    }
    return keptOutcome(displayedSource);
  }
  if (displayedCount > 0) return keptOutcome(displayedSource);
  console.error('Error fetching athlete results:', outcome.error);
  return 'failed';
}
