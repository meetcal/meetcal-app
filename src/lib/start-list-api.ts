import { SupabaseLiftResult } from '@/data/types/athletes';
import {
  fetchApiResultsByNames,
  fetchApiYearBests,
  fetchApiYearBestsByNames,
} from '@/lib/api/meetcal-api';
import { normalizeAthleteName } from '@/lib/athletes';
import {
  getAllCachedLiftingResultsForAthlete,
  getStoredAthleteBestsForNames,
  isAthleteBestsFresh,
  saveAthleteBestsBatch,
  type StoredAthleteBests,
} from '@/lib/database/offline-store';
import {
  getHistoryCutoffDate,
  toMeetCalendarDate,
  YEAR_BESTS_YEARS,
} from '@/utils/dateTime';

export type YearBests = { bestSnatch: number; bestCJ: number; bestTotal: number };

/**
 * The in-memory bests cache is keyed by athlete name and was never evicted, so
 * it grew with every roster the session ever touched — browsing a dozen large
 * meets left thousands of entries pinned for the life of the process. Bounded
 * to the most recent `YEAR_BESTS_CACHE_LIMIT` names (a couple of full start
 * lists' worth); a miss just re-reads AsyncStorage.
 */
export const YEAR_BESTS_CACHE_LIMIT = 2000;

/**
 * Each entry keeps when its answer was fetched, so it expires on the same
 * rule as the stored copy (`isAthleteBestsFresh`). Without it a running app
 * kept a "no results" or last week's bests for as long as it stayed open.
 */
const cache = new Map<string, { bests: YearBests; fetchedAt: number }>();
const inFlight = new Map<string, Promise<YearBests>>();

/**
 * Insertion-ordered eviction: `Map` keys iterate oldest-first. `fetchedAt`
 * is when the answer came from the API: now, or a stored entry's own time.
 */
function cacheBests(name: string, bests: YearBests, fetchedAt: number = Date.now()): void {
  cache.delete(name);
  cache.set(name, { bests, fetchedAt });
  while (cache.size > YEAR_BESTS_CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/** The memoized answer while it is fresh; an expired one is dropped. */
function getCachedBests(name: string): YearBests | null {
  const entry = cache.get(name);
  if (!entry) return null;
  if (isAthleteBestsFresh(toStoredBests(entry.bests), entry.fetchedAt, Date.now())) {
    return entry.bests;
  }
  cache.delete(name);
  return null;
}

const ZERO_BESTS: YearBests = { bestSnatch: 0, bestCJ: 0, bestTotal: 0 };

function maxPositive(values: (number | null | undefined)[]): number {
  return values.reduce<number>((max, v) => (typeof v === 'number' && v > 0 && v > max ? v : max), 0);
}

function deriveBestsFromResults(results: SupabaseLiftResult[]): YearBests {
  let bestSnatch = 0;
  let bestCJ = 0;
  let bestTotal = 0;
  for (const r of results) {
    const sn = maxPositive([r.snatch_best, r.snatch1, r.snatch2, r.snatch3]);
    const cj = maxPositive([r.cj_best, r.cj1, r.cj2, r.cj3]);
    const tot = typeof r.total === 'number' && r.total > 0 ? r.total : sn + cj;
    if (sn > bestSnatch) bestSnatch = sn;
    if (cj > bestCJ) bestCJ = cj;
    if (tot > bestTotal) bestTotal = tot;
  }
  return { bestSnatch, bestCJ, bestTotal };
}

function hasRealBests(bests: YearBests): boolean {
  return bests.bestSnatch > 0 || bests.bestCJ > 0 || bests.bestTotal > 0;
}

/**
 * Bests from an athlete's most recent meet only. Used as the fallback for
 * athletes with no results inside the year-bests window, so the start list
 * shows their last competition's numbers instead of "—".
 */
function deriveMostRecentMeetBests(results: SupabaseLiftResult[]): YearBests {
  if (results.length === 0) return ZERO_BESTS;
  const latest = results.reduce((newest, r) =>
    (r.date ?? '') > (newest.date ?? '') ? r : newest,
  );
  const latestMeetRows = results.filter(
    (r) => r.date === latest.date && r.meet === latest.meet,
  );
  return deriveBestsFromResults(latestMeetRows);
}

/**
 * Fetches each athlete's most recent meet date rows (`latest_only`) for
 * athletes whose year-bests came back empty and derives their bests from that
 * meet. `deriveMostRecentMeetBests` only ever reads the newest date's rows, so
 * the full career history it used to download changed nothing.
 *
 * @returns null when the request failed: the callers must not store (or
 * memoize) a failed lookup as "no results".
 */
async function getMostRecentMeetBestsBatch(
  names: string[],
): Promise<Record<string, YearBests> | null> {
  const byName: Record<string, YearBests> = {};
  if (names.length === 0) return byName;
  try {
    const rows = await fetchApiResultsByNames(names, { latestOnly: true });
    const grouped = new Map<string, SupabaseLiftResult[]>();
    rows.forEach((row) => {
      // `latest_only` bounds rows per normalized name (the API's
      // `normalize_name`), so group the same way rather than by raw spelling.
      const key = normalizeAthleteName(row.name);
      const group = grouped.get(key);
      if (group) {
        group.push(row);
      } else {
        grouped.set(key, [row]);
      }
    });
    names.forEach((name) => {
      byName[name] = deriveMostRecentMeetBests(grouped.get(normalizeAthleteName(name)) ?? []);
    });
  } catch {
    return null;
  }
  return byName;
}

function toStoredBests(bests: YearBests) {
  return {
    snatch_best: bests.bestSnatch > 0 ? bests.bestSnatch : null,
    cj_best: bests.bestCJ > 0 ? bests.bestCJ : null,
    total: bests.bestTotal > 0 ? bests.bestTotal : null,
  };
}

function fromStoredBests(bests: {
  snatch_best: number | null;
  cj_best: number | null;
  total: number | null;
}): YearBests {
  return {
    bestSnatch: bests.snatch_best ?? 0,
    bestCJ: bests.cj_best ?? 0,
    bestTotal: bests.total ?? 0,
  };
}

async function getOfflineFallback(athleteName: string): Promise<YearBests> {
  try {
    const results = await getAllCachedLiftingResultsForAthlete(athleteName);
    if (results.length === 0) return ZERO_BESTS;
    const cutoff = getHistoryCutoffDate(YEAR_BESTS_YEARS);
    // Result dates are calendar dates. `new Date("2025-06-01")` is UTC
    // midnight, and a date-only string is compared as a string.
    const recent = results.filter(r => {
      const day = toMeetCalendarDate(r.date);
      if (!day) return true;
      return day >= cutoff;
    });
    if (recent.length === 0) return deriveMostRecentMeetBests(results);
    return deriveBestsFromResults(recent);
  } catch {
    return ZERO_BESTS;
  }
}

export async function getLastYearBests(athleteName: string): Promise<YearBests> {
  const cached = getCachedBests(athleteName);
  if (cached != null) return cached;
  const active = inFlight.get(athleteName);
  if (active) return active;

  const request = getLastYearBestsUncached(athleteName).finally(() => {
    inFlight.delete(athleteName);
  });
  inFlight.set(athleteName, request);
  return request;
}

/**
 * Stores what the API answered. A failed write only costs the next view a
 * lookup, so it does not fail the bests that were just resolved.
 */
async function persistBests(bestsByName: Record<string, YearBests>): Promise<void> {
  const rows: Record<string, ReturnType<typeof toStoredBests>> = {};
  for (const [name, bests] of Object.entries(bestsByName)) rows[name] = toStoredBests(bests);
  if (Object.keys(rows).length === 0) return;
  try {
    await saveAthleteBestsBatch(rows);
  } catch (error) {
    console.warn('Could not store athlete bests:', error);
  }
}

/** A stale stored answer with real numbers: shown when a lookup cannot run. */
function staleRealBests(stored: StoredAthleteBests | undefined): YearBests | null {
  if (!stored) return null;
  const bests = fromStoredBests(stored.bests);
  return hasRealBests(bests) ? bests : null;
}

async function getLastYearBestsUncached(athleteName: string): Promise<YearBests> {
  // Freshness is `offline-store`'s rule, shared with session details: a
  // fresh entry is final, real numbers or "no results" alike; a stale one
  // (or one stored before entries carried a time) is looked up again.
  const stored = (await getStoredAthleteBestsForNames([athleteName]))[athleteName];
  if (stored?.isFresh) {
    const result = fromStoredBests(stored.bests);
    cacheBests(athleteName, result, stored.fetchedAt);
    return result;
  }

  try {
    const cutoffDate = getHistoryCutoffDate(YEAR_BESTS_YEARS);
    const results = await fetchApiYearBests(athleteName, cutoffDate);
    const result: YearBests =
      results.length === 0
        ? ZERO_BESTS
        : {
            bestSnatch: Math.max(...results.map(r => r.bestSnatch || 0)),
            bestCJ: Math.max(...results.map(r => r.bestCJ || 0)),
            bestTotal: Math.max(...results.map(r => r.bestTotal || 0)),
          };
    if (!hasRealBests(result)) {
      // Nothing inside the window: fall back to the most recent meet the
      // athlete ever competed at.
      const fallbackByName = await getMostRecentMeetBestsBatch([athleteName]);
      if (!fallbackByName) {
        return staleRealBests(stored) ?? ZERO_BESTS;
      }
      const fallback = fallbackByName[athleteName] ?? ZERO_BESTS;
      cacheBests(athleteName, fallback);
      await persistBests({ [athleteName]: fallback });
      return fallback;
    }
    cacheBests(athleteName, result);
    await persistBests({ [athleteName]: result });
    return result;
  } catch {
    // Offline or the request failed. Neither the stale copy nor what the
    // downloaded meets say is an answer, so nothing is stored or memoized:
    // storing it used to turn one offline view into "—" for good.
    return staleRealBests(stored) ?? (await getOfflineFallback(athleteName));
  }
}

export async function getLastYearBestsBatch(
  names: string[],
  options: { fetchMissing?: boolean } = {},
): Promise<Record<string, YearBests>> {
  const uniqueNames = Array.from(new Set(names.filter(Boolean)));
  const byName: Record<string, YearBests> = {};

  uniqueNames.forEach((name) => {
    const cached = getCachedBests(name);
    if (cached) {
      byName[name] = cached;
    }
  });

  const missingMemory = uniqueNames.filter((name) => byName[name] == null);
  // Stale stored answers with real numbers, shown when no lookup runs.
  const staleByName: Record<string, YearBests> = {};
  if (missingMemory.length > 0) {
    const stored = await getStoredAthleteBestsForNames(missingMemory);
    missingMemory.forEach((name) => {
      const entry = stored[name];
      if (!entry) return;
      // A fresh entry is final, "no results" included (it expires sooner).
      // A stale one is looked up again, which is also what gives rows
      // stored before entries carried a time another chance.
      if (entry.isFresh) {
        const result = fromStoredBests(entry.bests);
        cacheBests(name, result, entry.fetchedAt);
        byName[name] = result;
        return;
      }
      const stale = staleRealBests(entry);
      if (stale) staleByName[name] = stale;
    });
  }

  const missing = uniqueNames.filter((name) => byName[name] == null);
  if (options.fetchMissing === false) {
    missing.forEach((name) => {
      byName[name] = staleByName[name] ?? ZERO_BESTS;
    });
    return byName;
  }

  if (missing.length > 0) {
    const cutoffDate = getHistoryCutoffDate(YEAR_BESTS_YEARS);
    let fetched: Awaited<ReturnType<typeof fetchApiYearBestsByNames>>;
    try {
      fetched = await fetchApiYearBestsByNames(missing, cutoffDate);
    } catch (error) {
      // Offline or failed. The stale copies are better than nothing; with
      // none at all the caller still gets the failure.
      if (!missing.some((name) => staleByName[name])) throw error;
      missing.forEach((name) => {
        byName[name] = staleByName[name] ?? ZERO_BESTS;
      });
      return byName;
    }
    // The API keys its answer by the cleaned name (trimmed, whitespace
    // folded), so a roster spelling like ' Jane Doe' never matched its own
    // row under the raw key and was persisted as "no results". Match the way
    // `getMostRecentMeetBestsBatch` already does.
    const fetchedByNormalized = new Map<string, (typeof fetched)[string]>();
    for (const [key, row] of Object.entries(fetched)) {
      fetchedByNormalized.set(normalizeAthleteName(key), row);
    }
    const persisted: Record<string, YearBests> = {};

    const emptyNames: string[] = [];
    missing.forEach((name) => {
      const row = fetchedByNormalized.get(normalizeAthleteName(name));
      const bests = row
        ? {
            bestSnatch: row.bestSnatch || 0,
            bestCJ: row.bestCJ || 0,
            bestTotal: row.bestTotal || 0,
          }
        : ZERO_BESTS;
      if (!hasRealBests(bests)) {
        emptyNames.push(name);
        return;
      }
      byName[name] = bests;
      cacheBests(name, bests);
      persisted[name] = bests;
    });

    // Athletes with nothing inside the window: show their most recent
    // meet's numbers instead of "—".
    if (emptyNames.length > 0) {
      const fallbacks = await getMostRecentMeetBestsBatch(emptyNames);
      emptyNames.forEach((name) => {
        if (!fallbacks) {
          // The fallback lookup failed: not an answer, so not stored.
          byName[name] = staleByName[name] ?? ZERO_BESTS;
          return;
        }
        // Both lookups answered: all-zero is the API's "no results", stored
        // under the shorter empty TTL.
        const bests = fallbacks[name] ?? ZERO_BESTS;
        byName[name] = bests;
        cacheBests(name, bests);
        persisted[name] = bests;
      });
    }

    await persistBests(persisted);
  }

  return byName;
}

export function preloadYearBests(names: string[]): void {
  void getLastYearBestsBatch(names, { fetchMissing: false });
}
