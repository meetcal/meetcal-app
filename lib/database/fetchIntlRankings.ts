// You may want to import your supabase instance instead if you have a shared one
import { supabase } from '../supabase';
import { getOfflineCache, OFFLINE_CACHE_KEYS, setOfflineCache } from './offline-cache';

export type IntlRanking = {
  meet: string | null;
  ranking: number | null;
  name: string | null;
  weight_class: string | null;
  total: number | null;
  percent_a: number | null;
  gender: 'Men' | 'Women' | null;
  age_category: 'Senior' | 'Junior' | 'Youth' | 'U17' | 'U15' | null;
};

// Basic fetch function (add filters later)
export async function fetchIntlRankings(): Promise<IntlRanking[]> {
  const cacheKey = OFFLINE_CACHE_KEYS.intlRankings;

  try {
    const { data, error } = await supabase
      .from('intl_rankings')
      .select('*');

    if (error) {
      throw error;
    }

    const rankings = data as IntlRanking[];
    await setOfflineCache(cacheKey, rankings);
    return rankings;
  } catch (error) {
    const cached = await getOfflineCache<IntlRanking[]>(cacheKey);
    if (cached?.data) {
      return cached.data;
    }
    throw error;
  }
}
