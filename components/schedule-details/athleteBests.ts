import { SupabaseBests } from "@/data/types/athletes";
import { MeetName } from "@/data/types/meet";
import {
  getAllCachedLiftingResultsForAthlete,
  getCachedAthleteBestsForNames,
  saveAthleteBestsBatch,
} from "@/lib/database/offline-store";
import { fetchAthleteBestsForNames } from "@/lib/database/queries";
import { isNetworkAvailable } from "@/lib/networkUtils";

const bestsBatchInFlight = new Map<string, Promise<Record<string, SupabaseBests>>>();

function createEmptyBests(): SupabaseBests {
  return { snatch_best: null, cj_best: null, total: null };
}

function maxSuccessfulAttempt(
  attempts: (number | null | undefined)[],
): number | null {
  const successful = attempts.filter(
    (attempt): attempt is number => typeof attempt === "number" && attempt > 0,
  );
  if (successful.length === 0) return null;
  return Math.max(...successful);
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

  await Promise.all(
    names.map(async (name) => {
      let bests = createEmptyBests();
      try {
        const cachedResults = await getAllCachedLiftingResultsForAthlete(name);
        cachedResults.forEach((row) => {
          bests = mergeIntoBests(bests, deriveRowBests(row));
        });
      } catch {}
      bestsByName[name] = bests;
    }),
  );

  return bestsByName;
}

function hasStoredBests(
  name: string,
  cachedBests: Record<string, SupabaseBests | undefined>,
) {
  return Object.prototype.hasOwnProperty.call(cachedBests, name);
}

function createBatchKey(names: string[], meetId: MeetName): string {
  const normalizedNames = names
    .map((name) => name.trim().toLowerCase().replace(/\s+/g, " "))
    .sort();
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

export async function getCachedAthleteBestsBatch(
  names: string[],
): Promise<Record<string, SupabaseBests>> {
  const uniqueNames = Array.from(new Set(names.filter(Boolean)));
  const bestsByName: Record<string, SupabaseBests> = {};

  uniqueNames.forEach((name) => {
    bestsByName[name] = createEmptyBests();
  });

  if (uniqueNames.length === 0) {
    return bestsByName;
  }

  const cachedStoredBests = await getCachedAthleteBestsForNames(uniqueNames);
  uniqueNames.forEach((name) => {
    const cached = cachedStoredBests[name];
    if (cached) {
      bestsByName[name] = cached;
    }
  });

  return bestsByName;
}

async function getAthleteBestsBatchUncached(
  names: string[],
): Promise<Record<string, SupabaseBests>> {
  const uniqueNames = Array.from(new Set(names.filter(Boolean)));
  const bestsByName: Record<string, SupabaseBests> = {};

  uniqueNames.forEach((name) => {
    bestsByName[name] = createEmptyBests();
  });

  if (uniqueNames.length === 0) {
    return bestsByName;
  }

  const cachedStoredBests = await getCachedAthleteBestsForNames(uniqueNames);
  uniqueNames.forEach((name) => {
    const cached = cachedStoredBests[name];
    if (cached) {
      bestsByName[name] = cached;
    }
  });

  const namesMissingStoredBests = uniqueNames.filter(
    (name) => !hasStoredBests(name, cachedStoredBests),
  );
  if (namesMissingStoredBests.length === 0) {
    return bestsByName;
  }

  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) {
    const cachedOnly = await loadCachedBestsForNames(namesMissingStoredBests);
    Object.assign(bestsByName, cachedOnly);
    await saveAthleteBestsBatch(cachedOnly);
    return bestsByName;
  }

  try {
    const fetchedBestsByName = await fetchAthleteBestsForNames(
      namesMissingStoredBests,
    );

    Object.assign(bestsByName, fetchedBestsByName);

    const missingNames = namesMissingStoredBests.filter((name) => {
      const bests = fetchedBestsByName[name];
      return (
        bests.snatch_best == null && bests.cj_best == null && bests.total == null
      );
    });
    if (missingNames.length > 0) {
      const cachedBests = await loadCachedBestsForNames(missingNames);
      missingNames.forEach((name) => {
        bestsByName[name] = cachedBests[name] ?? createEmptyBests();
      });
    }
    await saveAthleteBestsBatch(
      namesMissingStoredBests.reduce<Record<string, SupabaseBests>>((acc, name) => {
        acc[name] = bestsByName[name] ?? createEmptyBests();
        return acc;
      }, {}),
    );
    return bestsByName;
  } catch {
    const fallback = await loadCachedBestsForNames(namesMissingStoredBests);
    Object.assign(bestsByName, fallback);
    await saveAthleteBestsBatch(fallback);
    return bestsByName;
  }
}
