import { createMutableResource } from '@/lib/data/mutable-resource';
import { getOfflineCache, OFFLINE_CACHE_KEYS, setOfflineCache } from './offline-cache';
import { getJson } from '@/lib/api/meetcal-api';

export type NationalRanking = {
  id: number;
  name: string;
  total: number;
};

type NationalRankingRow = {
  name: string | null;
  total: number | null;
};

type RankingsCache = Record<string, NationalRanking[]>;

function mapRankings(rows: NationalRankingRow[]): NationalRanking[] {
  const seenNames = new Set<string>();
  const rankings: NationalRanking[] = [];
  let idx = 0;

  rows.forEach((row) => {
    if (!row.name || row.total == null || seenNames.has(row.name)) return;
    seenNames.add(row.name);
    rankings.push({
      id: idx++,
      name: row.name,
      total: row.total,
    });
  });

  return rankings;
}

async function readNationalRankingsCache(weightClassAge: string) {
  const cached = await getOfflineCache<RankingsCache>(OFFLINE_CACHE_KEYS.nationalRankings);
  const data = cached?.data?.[weightClassAge];
  return data ? { data, lastUpdatedAt: cached.lastSynced } : null;
}

async function fetchNationalRankingsFresh(weightClassAge: string): Promise<NationalRanking[]> {
  const rows = await getJson<NationalRankingRow[]>('/data/nat-rankings', {
    federation: 'USAW',
    age_category: weightClassAge,
  });

  return mapRankings(rows);
}

async function persistNationalRankings(
  weightClassAge: string,
  rankings: NationalRanking[],
) {
  const cached = await getOfflineCache<RankingsCache>(
    OFFLINE_CACHE_KEYS.nationalRankings,
  );
  const nextCache: RankingsCache = {
    ...(cached?.data || {}),
    [weightClassAge]: rankings,
  };
  const entry = await setOfflineCache(OFFLINE_CACHE_KEYS.nationalRankings, nextCache);
  return { data: rankings, lastUpdatedAt: entry.lastSynced };
}

export const nationalRankingsResource = createMutableResource<
  NationalRanking[],
  [string]
>({
  getKey: (weightClassAge) =>
    `${OFFLINE_CACHE_KEYS.nationalRankings}:${weightClassAge}`,
  loadCached: (weightClassAge) => readNationalRankingsCache(weightClassAge),
  fetchFresh: (weightClassAge) => fetchNationalRankingsFresh(weightClassAge),
  persistFresh: (data, weightClassAge) =>
    persistNationalRankings(weightClassAge, data),
});

export async function fetchNationalRankings(weightClassAge: string): Promise<NationalRanking[]> {
  try {
    const rankings = await fetchNationalRankingsFresh(weightClassAge);
    await persistNationalRankings(weightClassAge, rankings);
    return rankings;
  } catch (error) {
    const cached = await readNationalRankingsCache(weightClassAge);
    if (cached?.data) {
      return cached.data;
    }
    throw error;
  }
}
