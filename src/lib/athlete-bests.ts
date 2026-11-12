/**
 * Athlete bests for session details, resolved for a whole session at once.
 * What they mean (the year window, else the most recent meet) and the lookup
 * that stores them are `lib/year-bests`, shared with the start list.
 *
 * This is a data-access module — in-flight dedupe, a stored-bests cache layer,
 * and an offline fallback that derives bests from downloaded meet results. It lives next to
 * `lib/athlete-prs` rather than under `components/` because it imports
 * `lib/database/*` and holds policy, not UI.
 */
import { AthleteBests, AthleteMeetResult } from "@/data/types/athletes";
import { MeetName } from "@/data/types/meet";
import { normalizeAthleteName } from "@/lib/athletes";
import { getAllCachedLiftingResultsForAthletes } from "@/lib/database/athlete-history-store";
import { getStoredAthleteBestsForNames, hasAnyAthleteBest, type StoredAthleteBests } from "@/lib/database/athlete-bests-store";
import { isNetworkAvailable } from "@/lib/networkUtils";
import {
  deriveDownloadedBests,
  emptyBests,
  lookUpAthleteBests,
} from "@/lib/year-bests";

const bestsBatchInFlight = new Map<string, Promise<Record<string, AthleteBests>>>();

async function loadCachedBestsForNames(
  names: string[],
): Promise<Record<string, AthleteBests>> {
  const bestsByName: Record<string, AthleteBests> = {};

  // One pass over the cached meets for the whole batch. Resolving athletes one
  // at a time re-inflated every cached meet's results blob per athlete, so a
  // 15-athlete session against three downloaded meets did 45 decompressions
  // instead of three. The scan inside is still sequential — it holds one
  // inflated meet at a time — so peak memory is unchanged and there is still
  // no Promise.all fan-out for the iOS watchdog to punish.
  let cachedResultsByName: Record<string, AthleteMeetResult[]> = {};
  try {
    cachedResultsByName = await getAllCachedLiftingResultsForAthletes(names);
  } catch {}

  // The same meaning as an online answer (`lib/year-bests`): the year
  // window, else the most recent meet. It used to be every downloaded meet.
  for (const name of names) {
    bestsByName[name] = deriveDownloadedBests(cachedResultsByName[name] ?? []);
  }

  return bestsByName;
}

async function loadStoredBests(names: string[]): Promise<{
  bestsByName: Record<string, AthleteBests>;
  namesNeedingLookup: string[];
  storedByName: Record<string, StoredAthleteBests>;
}> {
  const uniqueNames = Array.from(new Set(names.filter(Boolean)));
  const bestsByName: Record<string, AthleteBests> = {};

  uniqueNames.forEach((name) => {
    bestsByName[name] = emptyBests();
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
): Promise<Record<string, AthleteBests>> {
  const derived = await loadCachedBestsForNames(names);
  const bestsByName: Record<string, AthleteBests> = {};
  for (const name of names) {
    const stored = storedByName[name]?.bests;
    bestsByName[name] =
      stored && hasAnyAthleteBest(stored) ? stored : (derived[name] ?? emptyBests());
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
): Promise<Record<string, AthleteBests>> {
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
): Promise<Record<string, AthleteBests>> {
  const { bestsByName } = await loadStoredBests(names);
  return bestsByName;
}

async function getAthleteBestsBatchUncached(
  names: string[],
): Promise<Record<string, AthleteBests>> {
  const { bestsByName, namesNeedingLookup, storedByName } = await loadStoredBests(names);
  if (namesNeedingLookup.length === 0) {
    return bestsByName;
  }

  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) {
    Object.assign(bestsByName, await loadFallbackBests(namesNeedingLookup, storedByName));
    return bestsByName;
  }

  // `lookUpAthleteBests` is the start list's lookup too, so both screens
  // store one meaning under the athlete's entry: the year window, else the
  // most recent meet. It stores what the API answered.
  let lookup: Awaited<ReturnType<typeof lookUpAthleteBests>>;
  try {
    lookup = await lookUpAthleteBests(namesNeedingLookup);
  } catch {
    // A network error or timeout is not an answer either.
    Object.assign(bestsByName, await loadFallbackBests(namesNeedingLookup, storedByName));
    return bestsByName;
  }

  Object.assign(bestsByName, lookup.answered);
  if (lookup.unanswered.length > 0) {
    // The most-recent-meet lookup failed for these: shown, never stored.
    Object.assign(bestsByName, await loadFallbackBests(lookup.unanswered, storedByName));
  }
  return bestsByName;
}
