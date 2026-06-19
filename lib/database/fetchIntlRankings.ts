import { createMutableResource } from '@/lib/data/mutable-resource';
import { isNetworkAvailable } from '@/lib/networkUtils';
import { getOfflineCache, OFFLINE_CACHE_KEYS, setOfflineCache } from './offline-cache';
import { getJson } from '@/lib/api/meetcal-api';

export type IntlRanking = {
  meet: string;
  ranking: number;
  name: string;
  weightClass: string;
  total: number;
  percentA: number;
  gender: 'Men' | 'Women';
  ageCategory: 'Senior' | 'Junior' | 'Youth' | 'U17' | 'U15' | 'University';
};

type ApiIntlRanking = {
  meet: string | null;
  ranking: number | null;
  name: string | null;
  weight_class: string | null;
  total: number | null;
  percent_a: number | null;
  gender: 'Men' | 'Women' | null;
  age_category: 'Senior' | 'Junior' | 'Youth' | 'U17' | 'U15' | 'University' | null;
};

function isCompleteIntlRanking(row: ApiIntlRanking): row is {
  meet: string;
  ranking: number;
  name: string;
  weight_class: string;
  total: number;
  percent_a: number;
  gender: 'Men' | 'Women';
  age_category: IntlRanking['ageCategory'];
} {
  return Boolean(
    row.meet &&
      row.ranking != null &&
      row.name &&
      row.weight_class &&
      row.total != null &&
      row.percent_a != null &&
      row.gender &&
      row.age_category,
  );
}

async function readIntlRankingsCache() {
  const cached = await getOfflineCache<IntlRanking[]>(OFFLINE_CACHE_KEYS.intlRankings);
  return cached ? { data: cached.data, lastUpdatedAt: cached.lastSynced } : null;
}

async function fetchIntlRankingsFresh(): Promise<IntlRanking[]> {
  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) {
    throw new Error('Offline');
  }

  const rows = await getJson<ApiIntlRanking[]>('/data/intl-rankings');
  return rows.filter(isCompleteIntlRanking).map((row) => ({
    meet: row.meet,
    ranking: row.ranking,
    name: row.name,
    weightClass: row.weight_class,
    total: row.total,
    percentA: row.percent_a,
    gender: row.gender,
    ageCategory: row.age_category,
  }));
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
