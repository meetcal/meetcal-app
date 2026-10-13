import type { SupabaseBests } from '@/data/types/athletes';
import {
  getAllCachedLiftingResultsForAthlete,
  getStoredAthleteBestsForNames,
  isAthleteBestsFresh,
  type StoredAthleteBests,
} from '@/lib/database/offline-store';
import {
  deriveDownloadedBests,
  lookUpAthleteBests,
  type AthleteBestsLookup,
} from '@/lib/year-bests';

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

function hasRealBests(bests: YearBests): boolean {
  return bests.bestSnatch > 0 || bests.bestCJ > 0 || bests.bestTotal > 0;
}

function toStoredBests(bests: YearBests) {
  return {
    snatch_best: bests.bestSnatch > 0 ? bests.bestSnatch : null,
    cj_best: bests.bestCJ > 0 ? bests.bestCJ : null,
    total: bests.bestTotal > 0 ? bests.bestTotal : null,
  };
}

function fromStoredBests(bests: SupabaseBests): YearBests {
  return {
    bestSnatch: bests.snatch_best ?? 0,
    bestCJ: bests.cj_best ?? 0,
    bestTotal: bests.total ?? 0,
  };
}

/**
 * What the downloaded meets say, with the same meaning as an online answer
 * (`deriveDownloadedBests`). Shown offline, never stored.
 */
async function getOfflineFallback(athleteName: string): Promise<YearBests> {
  try {
    const results = await getAllCachedLiftingResultsForAthlete(athleteName);
    return fromStoredBests(deriveDownloadedBests(results));
  } catch {
    return ZERO_BESTS;
  }
}

/** A stale stored answer with real numbers: shown when a lookup cannot run. */
function staleRealBests(stored: StoredAthleteBests | undefined): YearBests | null {
  if (!stored) return null;
  const bests = fromStoredBests(stored.bests);
  return hasRealBests(bests) ? bests : null;
}

/**
 * Batch lookups still running, by name, with the stored entry each name had.
 * A row expanded while the warm-up (or a sort) is looking its athlete up
 * waits for that answer instead of sending its own two requests.
 */
const lookupsInFlight = new Map<
  string,
  { lookup: Promise<AthleteBestsLookup>; stored: StoredAthleteBests | undefined }
>();

/**
 * The largest batch a row joins: one `results:bests` request (the warm-up's
 * size). A best-lift sort looks the whole roster up, which for a national
 * meet is 16 sequential requests plus the store write; a row joining that
 * waited for all of it, so it sends its own lookup instead.
 */
const JOINABLE_LOOKUP_MAX_NAMES = 100; // `SMALL_ROWS_NAMES_CHUNK_SIZE` in meetcal-api

/**
 * One name's bests from a lookup (`lookUpAthleteBests` already stored the
 * answer). Neither the stale copy nor the downloaded meets are an answer, so
 * when the lookup failed nothing is memoized: memoizing it used to turn one
 * offline view into "—" for good.
 */
async function settleFromLookup(
  athleteName: string,
  stored: StoredAthleteBests | undefined,
  lookup: Promise<AthleteBestsLookup>,
): Promise<YearBests> {
  let result: AthleteBestsLookup;
  try {
    result = await lookup;
  } catch {
    // Offline or the request failed.
    return staleRealBests(stored) ?? (await getOfflineFallback(athleteName));
  }
  const answer = result.answered[athleteName];
  if (!answer) {
    // The most-recent-meet lookup failed.
    return staleRealBests(stored) ?? ZERO_BESTS;
  }
  const bests = fromStoredBests(answer);
  cacheBests(athleteName, bests);
  return bests;
}

export async function getLastYearBests(athleteName: string): Promise<YearBests> {
  const cached = getCachedBests(athleteName);
  if (cached != null) return cached;
  const active = inFlight.get(athleteName);
  if (active) return active;
  const batch = lookupsInFlight.get(athleteName);
  if (batch) return settleFromLookup(athleteName, batch.stored, batch.lookup);

  const request = getLastYearBestsUncached(athleteName).finally(() => {
    inFlight.delete(athleteName);
  });
  inFlight.set(athleteName, request);
  return request;
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
  return settleFromLookup(athleteName, stored, lookUpAthleteBests([athleteName]));
}

/**
 * Bests for each name. When the lookup fails, names with a stale stored
 * answer get it and names without one are left out of the result (it
 * rejects when no name has one).
 */
export async function getLastYearBestsBatch(names: string[]): Promise<Record<string, YearBests>> {
  const uniqueNames = Array.from(new Set(names.filter(Boolean)));
  const byName: Record<string, YearBests> = {};

  uniqueNames.forEach((name) => {
    const cached = getCachedBests(name);
    if (cached) {
      byName[name] = cached;
    }
  });

  const missingMemory = uniqueNames.filter((name) => byName[name] == null);
  const stored: Record<string, StoredAthleteBests> =
    missingMemory.length > 0 ? await getStoredAthleteBestsForNames(missingMemory) : {};
  // Stale stored answers with real numbers, shown when no lookup answers.
  const staleByName: Record<string, YearBests> = {};
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

  // Names a row (or another batch) is already looking up join that lookup
  // instead of asking again. Checked after the storage read, with no await
  // before this batch registers its own names below.
  const joined = new Map<string, Promise<YearBests>>();
  const missing = uniqueNames.filter((name) => {
    if (byName[name] != null) return false;
    const single = inFlight.get(name);
    if (single) {
      joined.set(name, single);
      return false;
    }
    const batch = lookupsInFlight.get(name);
    if (batch) {
      joined.set(name, settleFromLookup(name, batch.stored, batch.lookup));
      return false;
    }
    return true;
  });
  const settleJoined = async () => {
    for (const [name, pending] of joined) {
      try {
        byName[name] = await pending;
      } catch {
        // That lookup's own caller hears about it; this one leaves it out.
      }
    }
  };
  if (missing.length === 0) {
    await settleJoined();
    return byName;
  }

  const lookup = lookUpAthleteBests(missing);
  if (missing.length <= JOINABLE_LOOKUP_MAX_NAMES) {
    missing.forEach((name) => lookupsInFlight.set(name, { lookup, stored: stored[name] }));
    const forget = () => {
      missing.forEach((name) => {
        if (lookupsInFlight.get(name)?.lookup === lookup) lookupsInFlight.delete(name);
      });
    };
    // Both branches, so a failed lookup is not also an unhandled rejection here.
    lookup.then(forget, forget);
  }

  let result: AthleteBestsLookup;
  try {
    result = await lookup;
  } catch (error) {
    await settleJoined();
    // Offline or failed. The stale copies are better than nothing; with
    // none at all the caller still gets the failure. A name with no stale
    // copy is left out rather than given zeros: nothing answered that it
    // has no results.
    if (!missing.some((name) => staleByName[name])) throw error;
    missing.forEach((name) => {
      const stale = staleByName[name];
      if (stale) byName[name] = stale;
    });
    return byName;
  }
  await settleJoined();

  missing.forEach((name) => {
    const answer = result.answered[name];
    if (!answer) {
      // The most-recent-meet lookup failed: not an answer, so not memoized.
      byName[name] = staleByName[name] ?? ZERO_BESTS;
      return;
    }
    const bests = fromStoredBests(answer);
    byName[name] = bests;
    cacheBests(name, bests);
  });
  return byName;
}

/**
 * Warms the bests of the names the start list opens on, so expanding a row
 * reads them from memory instead of sending its own requests. The caller
 * caps the names (`YEAR_BESTS_PREFETCH_NAME_CAP`), so this is one
 * `results:bests` request plus, for the names with nothing in the window,
 * one `latest_only` request. A failure is left to the rows' own lookups.
 */
export function preloadYearBests(names: string[]): void {
  getLastYearBestsBatch(names).catch(() => {});
}
