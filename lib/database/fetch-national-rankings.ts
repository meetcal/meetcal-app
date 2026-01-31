import { supabase } from '@/lib/supabase';
import { getOfflineCache, OFFLINE_CACHE_KEYS, setOfflineCache } from './offline-cache';

export type NationalRanking = {
  id: number;
  name: string;
  total: number;
};

type NationalRankingRow = {
  id: number;
  name: string | null;
  total: number | null;
  age: string | null;
};

type RankingsCache = Record<string, NationalRanking[]>;

export async function fetchNationalRankings(weightClassAge: string): Promise<NationalRanking[]> {
  const cacheKey = OFFLINE_CACHE_KEYS.nationalRankings;

  try {
    const { data, error } = await supabase
      .from('lifting_results')
      .select('id, name, total, age')
      .eq('federation', 'USAW')
      .eq('age', weightClassAge)
      .order('total', { ascending: false });

    if (error) throw error;

    const rows = (data || []) as NationalRankingRow[];
    const bestByName = new Map<string, NationalRankingRow>();

    rows.forEach((row) => {
      if (!row.name) return;
      if (row.total == null) return;

      const existing = bestByName.get(row.name);
      if (!existing || (row.total ?? 0) > (existing.total ?? 0)) {
        bestByName.set(row.name, row);
      }
    });

    const rankings = Array.from(bestByName.values())
      .map((row) => ({
        id: row.id,
        name: row.name ?? '',
        total: row.total ?? 0,
      }))
      .sort((a, b) => b.total - a.total);

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
      return cachedRankings;
    }
    throw error;
  }
}
