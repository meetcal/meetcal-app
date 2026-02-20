import { SupabaseBests } from "@/data/types/athletes";
import { MeetName } from "@/data/types/meet";
import { getAthleteLiftingResults } from "@/lib/database/offline-store";
import { isNetworkAvailable } from "@/lib/networkUtils";
import { supabase } from "@/lib/supabase";

function createEmptyBests(): SupabaseBests {
  return { snatch_best: null, cj_best: null, total: null };
}

function maxSuccessfulAttempt(
  attempts: Array<number | null | undefined>,
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
  meetId: MeetName,
): Promise<Record<string, SupabaseBests>> {
  const bestsByName: Record<string, SupabaseBests> = {};

  await Promise.all(
    names.map(async (name) => {
      let bests = createEmptyBests();
      try {
        const cachedResults = await getAthleteLiftingResults(meetId, name);
        cachedResults.forEach((row) => {
          bests = mergeIntoBests(bests, deriveRowBests(row));
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
    const cachedOnly = await loadCachedBestsForNames(uniqueNames, meetId);
    return cachedOnly;
  }

  try {
    const { data, error } = await supabase
      .from("lifting_results")
      .select("name,snatch_best,cj_best,total,snatch1,snatch2,snatch3,cj1,cj2,cj3")
      .in("name", uniqueNames);

    if (error) {
      throw error;
    }

    (data || []).forEach((record) => {
      if (!record.name) return;
      const current = bestsByName[record.name] || createEmptyBests();
      bestsByName[record.name] = mergeIntoBests(current, deriveRowBests(record));
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
