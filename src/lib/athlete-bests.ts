/**
 * Athlete lifetime bests, resolved for a whole session at once.
 *
 * This is a data-access module — in-flight dedupe, a stored-bests cache layer,
 * an offline fallback that derives bests from downloaded meet results, and the
 * write-back that keeps the stored layer warm. It lives next to
 * `lib/athlete-prs` rather than under `components/` because it imports
 * `lib/database/*` and holds policy, not UI.
 */
import { SupabaseBests, SupabaseLiftResult } from "@/data/types/athletes";
import { MeetName } from "@/data/types/meet";
import { maxSuccessfulAttempt, normalizeAthleteName } from "@/lib/athletes";
import {
  getAllCachedLiftingResultsForAthletes,
  getStoredAthleteBestsForNames,
  hasAnyAthleteBest,
  saveAthleteBestsBatch,
  type StoredAthleteBests,
} from "@/lib/database/offline-store";
import { fetchAthleteBestsForNames } from "@/lib/database/queries";
import { isNetworkAvailable } from "@/lib/networkUtils";

const bestsBatchInFlight = new Map<string, Promise<Record<string, SupabaseBests>>>();

function createEmptyBests(): SupabaseBests {
  return { snatch_best: null, cj_best: null, total: null };
}

function deriveRowBests(row: {
  snatch_best?: number | null;
  cj_best?: number | null;
  total?: number | null;
  snatch1?: number | null;
  snatch2?: number | null;
  snatch3?: number | null;
  cj1?: number | null;
  cj2?: number | null;
  cj3?: number | null;
}) {
  const snatchBest =
    row.snatch_best ??
    maxSuccessfulAttempt([row.snatch1, row.snatch2, row.snatch3]);
  const cjBest =
    row.cj_best ?? maxSuccessfulAttempt([row.cj1, row.cj2, row.cj3]);
  const total = row.total ?? (snatchBest != null && cjBest != null ? snatchBest + cjBest : null);
  return {
    snatch_best: snatchBest,
    cj_best: cjBest,
    total,
  };
}

function maxNullable(
  current: number | null | undefined,
  incoming: number | null | undefined,
): number | null {
  if (current == null && incoming == null) return null;
  if (current == null) return incoming ?? null;
  if (incoming == null) return current;
  return Math.max(current, incoming);
}

function mergeIntoBests(
  current: SupabaseBests,
  next: {
    snatch_best?: number | null;
    cj_best?: number | null;
    total?: number | null;
  },
): SupabaseBests {
  return {
    snatch_best: maxNullable(current.snatch_best, next.snatch_best),
    cj_best: maxNullable(current.cj_best, next.cj_best),
    total: maxNullable(current.total, next.total),
  };
}

async function loadCachedBestsForNames(
  names: string[],
): Promise<Record<string, SupabaseBests>> {
  const bestsByName: Record<string, SupabaseBests> = {};

  // One pass over the cached meets for the whole batch. Resolving athletes one
  // at a time re-inflated every cached meet's results blob per athlete, so a
  // 15-athlete session against three downloaded meets did 45 decompressions
  // instead of three. The scan inside is still sequential — it holds one
  // inflated meet at a time — so peak memory is unchanged and there is still
  // no Promise.all fan-out for the iOS watchdog to punish.
  let cachedResultsByName: Record<string, SupabaseLiftResult[]> = {};
  try {
    cachedResultsByName = await getAllCachedLiftingResultsForAthletes(names);
  } catch {}

  for (const name of names) {
    let bests = createEmptyBests();
    for (const row of cachedResultsByName[name] ?? []) {
      bests = mergeIntoBests(bests, deriveRowBests(row));
    }
    bestsByName[name] = bests;
  }

  return bestsByName;
}

/**
 * The stored-bests layer, shared by both entry points: de-duplicate the
 * names, seed every one with an empty record, then overwrite whatever
 * `offline-store` already holds, fresh or not (a stale answer still beats
 * "—"). `getCachedAthleteBestsBatch` stops here;
 * `getAthleteBestsBatchUncached` continues with `namesNeedingLookup`.
 *
 * Freshness is `offline-store`'s rule (`isAthleteBestsFresh`), the one the
 * start list uses too: a stored all-null entry used to count as a final
 * "no results" forever, even when it was an offline or failed lookup's
 * fallback.
 */
async function loadStoredBests(names: string[]): Promise<{
  bestsByName: Record<string, SupabaseBests>;
  namesNeedingLookup: string[];
  storedByName: Record<string, StoredAthleteBests>;
}> {
  const uniqueNames = Array.from(new Set(names.filter(Boolean)));
  const bestsByName: Record<string, SupabaseBests> = {};

  uniqueNames.forEach((name) => {
    bestsByName[name] = createEmptyBests();
  });

  if (uniqueNames.length === 0) {
    return { bestsByName, namesNeedingLookup: [], storedByName: {} };
  }

  const storedByName = await getStoredAthleteBestsForNames(uniqueNames);
  uniqueNames.forEach((name) => {
    const stored = storedByName[name];
    if (stored) {
      bestsByName[name] = stored.bests;
    }
  });

  return {
    bestsByName,
    namesNeedingLookup: uniqueNames.filter((name) => !storedByName[name]?.isFresh),
    storedByName,
  };
}

/**
 * Bests for names the API could not answer (offline, or the request failed):
 * a stale stored answer with real numbers if there is one, else what the
 * downloaded meets' results say. Never persisted. Storing this fallback is
 * what turned one offline session view into a permanent "—" for the athlete.
 */
async function loadFallbackBests(
  names: string[],
  storedByName: Record<string, StoredAthleteBests>,
): Promise<Record<string, SupabaseBests>> {
  const derived = await loadCachedBestsForNames(names);
  const bestsByName: Record<string, SupabaseBests> = {};
  for (const name of names) {
    const stored = storedByName[name]?.bests;
    bestsByName[name] =
      stored && hasAnyAthleteBest(stored) ? stored : (derived[name] ?? createEmptyBests());
  }
  return bestsByName;
}

function createBatchKey(names: string[], meetId: MeetName): string {
  const normalizedNames = names.map(normalizeAthleteName).sort();
  return `${meetId}:${normalizedNames.join("|")}`;
}

export async function getAthleteBestsBatch(
  names: string[],
  meetId: MeetName,
): Promise<Record<string, SupabaseBests>> {
  const key = createBatchKey(names, meetId);
  const inFlight = bestsBatchInFlight.get(key);
  if (inFlight) return inFlight;

  const request = getAthleteBestsBatchUncached(names).finally(() => {
    bestsBatchInFlight.delete(key);
  });
  bestsBatchInFlight.set(key, request);
  return request;
}

/** Stored bests only — never touches the network. */
export async function getCachedAthleteBestsBatch(
  names: string[],
): Promise<Record<string, SupabaseBests>> {
  const { bestsByName } = await loadStoredBests(names);
  return bestsByName;
}

async function getAthleteBestsBatchUncached(
  names: string[],
): Promise<Record<string, SupabaseBests>> {
  const { bestsByName, namesNeedingLookup, storedByName } = await loadStoredBests(names);
  if (namesNeedingLookup.length === 0) {
    return bestsByName;
  }

  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) {
    Object.assign(bestsByName, await loadFallbackBests(namesNeedingLookup, storedByName));
    return bestsByName;
  }

  let fetchedBestsByName: Record<string, SupabaseBests>;
  try {
    fetchedBestsByName = await fetchAthleteBestsForNames(namesNeedingLookup);
  } catch {
    // A network error or timeout is not an answer either.
    Object.assign(bestsByName, await loadFallbackBests(namesNeedingLookup, storedByName));
    return bestsByName;
  }

  Object.assign(bestsByName, fetchedBestsByName);

  const missingNames = namesNeedingLookup.filter((name) => {
    const bests = fetchedBestsByName[name];
    return !bests || !hasAnyAthleteBest(bests);
  });
  if (missingNames.length > 0) {
    const cachedBests = await loadCachedBestsForNames(missingNames);
    missingNames.forEach((name) => {
      bestsByName[name] = cachedBests[name] ?? createEmptyBests();
    });
  }
  // The API answered, so this is stored, all-null rows included: those are
  // its "no results" and expire after `ATHLETE_BESTS_EMPTY_TTL_MS`. A failed
  // write only costs the next view a lookup; the answer is still shown.
  try {
    await saveAthleteBestsBatch(
      namesNeedingLookup.reduce<Record<string, SupabaseBests>>((acc, name) => {
        acc[name] = bestsByName[name] ?? createEmptyBests();
        return acc;
      }, {}),
    );
  } catch {}
  return bestsByName;
}
