import { convex } from '@/lib/convex';
import { api } from '@/convex/_generated/api';
import { createMutableResource } from '@/lib/data/mutable-resource';
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

async function readIntlRankingsCache() {
  const cached = await getOfflineCache<IntlRanking[]>(OFFLINE_CACHE_KEYS.intlRankings);
  return cached ? { data: cached.data, lastUpdatedAt: cached.lastSynced } : null;
}

async function fetchIntlRankingsFresh(): Promise<IntlRanking[]> {
  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) {
    throw new Error('Offline');
  }

  return await convex.query(api.intlRankings.getAll, {}) as IntlRanking[];
}

async function persistIntlRankings(rankings: IntlRanking[]) {
  const entry = await setOfflineCache(OFFLINE_CACHE_KEYS.intlRankings, rankings);
  return { data: entry.data, lastUpdatedAt: entry.lastSynced };
}

export const intlRankingsResource = createMutableResource<IntlRanking[], []>({
  getKey: () => OFFLINE_CACHE_KEYS.intlRankings,
  loadCached: () => readIntlRankingsCache(),
  fetchFresh: () => fetchIntlRankingsFresh(),
  persistFresh: (data) => persistIntlRankings(data),
});

export async function fetchIntlRankings(): Promise<IntlRanking[]> {
  try {
    const rankings = await fetchIntlRankingsFresh();
    await persistIntlRankings(rankings);
    return rankings;
  } catch (error) {
    const cached = await readIntlRankingsCache();
    if (cached?.data) {
      return cached.data;
    }
    throw error;
  }
}
