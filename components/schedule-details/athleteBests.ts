import { SupabaseBests } from "@/data/types/athletes";
import { MeetName } from "@/data/types/meet";
import { getAthleteLiftingResults } from "@/lib/database/offline-store";
import { isNetworkAvailable } from "@/lib/networkUtils";
import { supabase } from "@/lib/supabase";

function createEmptyBests(): SupabaseBests {
  return { snatch_best: null, cj_best: null, total: null };
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
  meetId: MeetName,
): Promise<Record<string, SupabaseBests>> {
  const bestsByName: Record<string, SupabaseBests> = {};

  await Promise.all(
    names.map(async (name) => {
      let bests = createEmptyBests();
      try {
        const cachedResults = await getAthleteLiftingResults(meetId, name);
        cachedResults.forEach((row) => {
          bests = mergeIntoBests(bests, {
            snatch_best: row?.snatch_best ?? null,
            cj_best: row?.cj_best ?? null,
            total: row?.total ?? null,
          });
        });
      } catch {}
      bestsByName[name] = bests;
    }),
  );

  return bestsByName;
}

export async function getAthleteBestsBatch(
  names: string[],
  meetId: MeetName,
): Promise<Record<string, SupabaseBests>> {
  const uniqueNames = Array.from(new Set(names.filter(Boolean)));
  const bestsByName: Record<string, SupabaseBests> = {};

  uniqueNames.forEach((name) => {
    bestsByName[name] = createEmptyBests();
  });

  if (uniqueNames.length === 0) {
    return bestsByName;
  }

  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) {
    return await loadCachedBestsForNames(uniqueNames, meetId);
  }

  try {
    const { data, error } = await supabase
      .from("lifting_results")
      .select("name,snatch_best,cj_best,total")
      .in("name", uniqueNames);

    if (error) {
      throw error;
    }

    (data || []).forEach((record) => {
      if (!record.name) return;
      const current = bestsByName[record.name] || createEmptyBests();
      bestsByName[record.name] = mergeIntoBests(current, {
        snatch_best: record.snatch_best ?? null,
        cj_best: record.cj_best ?? null,
        total: record.total ?? null,
      });
    });

    const missingNames = uniqueNames.filter((name) => {
      const bests = bestsByName[name];
      return (
        bests.snatch_best == null && bests.cj_best == null && bests.total == null
      );
    });
    if (missingNames.length > 0) {
      const cachedBests = await loadCachedBestsForNames(missingNames, meetId);
      missingNames.forEach((name) => {
        bestsByName[name] = cachedBests[name] ?? createEmptyBests();
      });
    }

    return bestsByName;
  } catch {
    return await loadCachedBestsForNames(uniqueNames, meetId);
  }
}
