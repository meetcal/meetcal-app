import { SupabaseLiftResult } from '@/data/types/athletes';
import {
  fetchApiResultsByNames,
  fetchApiYearBests,
  fetchApiYearBestsByNames,
} from '@/lib/api/meetcal-api';
import {
  getAllCachedLiftingResultsForAthlete,
  getCachedAthleteBestsForNames,
  saveAthleteBestsBatch,
} from '@/lib/database/offline-store';

export type YearBests = { bestSnatch: number; bestCJ: number; bestTotal: number };

const cache = new Map<string, YearBests>();
const inFlight = new Map<string, Promise<YearBests>>();

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
 * Fetches full histories for athletes whose year-bests came back empty and
 * derives each athlete's bests from their most recent meet.
 */
async function getMostRecentMeetBestsBatch(
  names: string[],
): Promise<Record<string, YearBests>> {
  const byName: Record<string, YearBests> = {};
  if (names.length === 0) return byName;
  try {
    const rows = await fetchApiResultsByNames(names);
    const grouped = new Map<string, SupabaseLiftResult[]>();
    rows.forEach((row) => {
      const group = grouped.get(row.name);
      if (group) {
        group.push(row);
      } else {
        grouped.set(row.name, [row]);
      }
    });
    names.forEach((name) => {
      byName[name] = deriveMostRecentMeetBests(grouped.get(name) ?? []);
    });
  } catch {
    names.forEach((name) => {
      byName[name] = ZERO_BESTS;
    });
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
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const cutoff = oneYearAgo.toISOString().split('T')[0];
    const recent = results.filter(r => {
      if (!r.date) return true;
      const d = new Date(r.date);
      if (isNaN(d.getTime())) return true;
      return d.toISOString().split('T')[0] >= cutoff;
    });
    if (recent.length === 0) return deriveMostRecentMeetBests(results);
    return deriveBestsFromResults(recent);
  } catch {
    return ZERO_BESTS;
  }
}

export async function getLastYearBests(athleteName: string): Promise<YearBests> {
  const cached = cache.get(athleteName);
  if (cached != null) return cached;
  const active = inFlight.get(athleteName);
  if (active) return active;

  const request = getLastYearBestsUncached(athleteName).finally(() => {
    inFlight.delete(athleteName);
  });
  inFlight.set(athleteName, request);
  return request;
}

async function getLastYearBestsUncached(athleteName: string): Promise<YearBests> {
  const stored = await getCachedAthleteBestsForNames([athleteName]);
  const storedBests = stored[athleteName];
  if (storedBests) {
    const result = fromStoredBests(storedBests);
    // Stored all-null rows (athletes cached before the most-recent-meet
    // fallback existed) fall through so they get another chance to resolve.
    if (hasRealBests(result)) {
      cache.set(athleteName, result);
      return result;
    }
  }

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  try {
    const cutoffDate = oneYearAgo.toISOString().split('T')[0];
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
      const fallback = fallbackByName[athleteName] ?? ZERO_BESTS;
      cache.set(athleteName, fallback);
      if (hasRealBests(fallback)) {
        await saveAthleteBestsBatch({ [athleteName]: toStoredBests(fallback) });
      }
      return fallback;
    }
    cache.set(athleteName, result);
    await saveAthleteBestsBatch({ [athleteName]: toStoredBests(result) });
    return result;
  } catch {
    const fallback = await getOfflineFallback(athleteName);
    if (hasRealBests(fallback)) {
      cache.set(athleteName, fallback);
      await saveAthleteBestsBatch({ [athleteName]: toStoredBests(fallback) });
    }
    return fallback;
  }
}

export async function getLastYearBestsBatch(
  names: string[],
  options: { fetchMissing?: boolean } = {},
): Promise<Record<string, YearBests>> {
  const uniqueNames = Array.from(new Set(names.filter(Boolean)));
  const byName: Record<string, YearBests> = {};

  uniqueNames.forEach((name) => {
    const cached = cache.get(name);
    if (cached) {
      byName[name] = cached;
    }
  });

  const missingMemory = uniqueNames.filter((name) => byName[name] == null);
  if (missingMemory.length > 0) {
    const stored = await getCachedAthleteBestsForNames(missingMemory);
    missingMemory.forEach((name) => {
      const storedBests = stored[name];
      if (!storedBests) return;
      const result = fromStoredBests(storedBests);
      // Skip stored all-null rows so athletes cached before the
      // most-recent-meet fallback existed get another chance to resolve.
      if (!hasRealBests(result)) return;
      cache.set(name, result);
      byName[name] = result;
    });
  }

  const missing = uniqueNames.filter((name) => byName[name] == null);
  if (options.fetchMissing === false) {
    missing.forEach((name) => {
      byName[name] = ZERO_BESTS;
    });
    return byName;
  }

  if (missing.length > 0) {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const cutoffDate = oneYearAgo.toISOString().split('T')[0];
    const fetched = await fetchApiYearBestsByNames(missing, cutoffDate);
    const persisted: Record<string, ReturnType<typeof toStoredBests>> = {};

    const emptyNames: string[] = [];
    missing.forEach((name) => {
      const row = fetched[name];
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
      cache.set(name, bests);
      persisted[name] = toStoredBests(bests);
    });

    // Athletes with nothing inside the window: show their most recent
    // meet's numbers instead of "—".
    if (emptyNames.length > 0) {
      const fallbacks = await getMostRecentMeetBestsBatch(emptyNames);
      emptyNames.forEach((name) => {
        const bests = fallbacks[name] ?? ZERO_BESTS;
        byName[name] = bests;
        cache.set(name, bests);
        if (hasRealBests(bests)) {
          persisted[name] = toStoredBests(bests);
        }
      });
    }

    await saveAthleteBestsBatch(persisted);
  }

  return byName;
}

export function preloadYearBests(names: string[]): void {
  void getLastYearBestsBatch(names, { fetchMissing: false });
}
