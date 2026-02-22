import { convex } from '@/lib/convex';
import { api } from '@/convex/_generated/api';
import { getOfflineCache, OFFLINE_CACHE_KEYS, setOfflineCache } from './offline-cache';

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
const rankingsMemoryCache = new Map<string, NationalRanking[]>();
const inFlightRankings = new Map<string, Promise<NationalRanking[]>>();

export async function fetchNationalRankings(weightClassAge: string): Promise<NationalRanking[]> {
  if (rankingsMemoryCache.has(weightClassAge)) {
    return rankingsMemoryCache.get(weightClassAge)!;
  }
  if (inFlightRankings.has(weightClassAge)) {
    return inFlightRankings.get(weightClassAge)!;
  }

  const cacheKey = OFFLINE_CACHE_KEYS.nationalRankings;
  const request = (async () => {
    try {
      const rows = await convex.query(api.liftingResults.getNationalRankings, {
        federation: 'USAW',
        ageCategory: weightClassAge,
      }) as NationalRankingRow[];

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

      rankingsMemoryCache.set(weightClassAge, rankings);

      const cached = await getOfflineCache<RankingsCache>(cacheKey);
      const nextCache: RankingsCache = {
        ...(cached?.data || {}),
        [weightClassAge]: rankings,
      };
      await setOfflineCache(cacheKey, nextCache);

      return rankings;
    } catch (error) {
      const cached = await getOfflineCache<RankingsCache>(cacheKey);
      const cachedRankings = cached?.data?.[weightClassAge];
      if (cachedRankings) {
        rankingsMemoryCache.set(weightClassAge, cachedRankings);
        return cachedRankings;
      }
      throw error;
    } finally {
      inFlightRankings.delete(weightClassAge);
    }
  })();

  inFlightRankings.set(weightClassAge, request);
  return request;
}
