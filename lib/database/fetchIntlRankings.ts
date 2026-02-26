import { convex } from '@/lib/convex';
import { api } from '@/convex/_generated/api';
import { isNetworkAvailable } from '@/lib/networkUtils';
import { getOfflineCache, OFFLINE_CACHE_KEYS, setOfflineCache } from './offline-cache';

export type IntlRanking = {
  meet: string | null;
  ranking: number | null;
  name: string | null;
  weightClass: string | null;
  total: number | null;
  percentA: number | null;
  gender: 'Men' | 'Women' | null;
  ageCategory: 'Senior' | 'Junior' | 'Youth' | 'U17' | 'U15' | null;
};

const rankingsMemoryCache: { data: IntlRanking[] | null } = { data: null };
let inFlightRankings: Promise<IntlRanking[]> | null = null;

// Basic fetch function (add filters later)
export async function fetchIntlRankings(): Promise<IntlRanking[]> {
  if (rankingsMemoryCache.data) {
    return rankingsMemoryCache.data;
  }
  if (inFlightRankings) {
    return inFlightRankings;
  }

  const cacheKey = OFFLINE_CACHE_KEYS.intlRankings;
  inFlightRankings = (async () => {
    try {
      const hasNetwork = await isNetworkAvailable();
      if (!hasNetwork) {
        throw new Error('Offline');
      }

      const rankings = await convex.query(api.intlRankings.getAll, {}) as IntlRanking[];
      rankingsMemoryCache.data = rankings;
      await setOfflineCache(cacheKey, rankings);
      return rankings;
    } catch (error) {
      const cached = await getOfflineCache<IntlRanking[]>(cacheKey);
      if (cached?.data) {
        rankingsMemoryCache.data = cached.data;
        return cached.data;
      }
      throw error;
    } finally {
      inFlightRankings = null;
    }
  })();

  return inFlightRankings;
}
