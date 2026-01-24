import { supabase } from '@/lib/supabase';
import { StandardsData, AgeGroupStandards, StandardRecord } from '@/types/standards';
import { getOfflineCache, OFFLINE_CACHE_KEYS, setOfflineCache } from './offline-cache';

type StandardsRow = {
  age_category: keyof StandardsData;
  gender: 'men' | 'women';
  weight_class: string;
  standard_a: number | null;
  standard_b: number | null;
};

/**
 * Fetches standards data from Supabase and organizes it into the StandardsData shape.
 * If ageGroup and gender are provided, fetches only that subset.
 */
export async function fetchStandards(
  ageGroup?: string,
  gender?: 'men' | 'women'
): Promise<StandardsData> {
  const cacheKey = OFFLINE_CACHE_KEYS.standards;

  try {
    let query = supabase
      .from('standards')
      .select('*');
    if (ageGroup) query = query.eq('age_category', ageGroup);
    if (gender) query = query.eq('gender', gender);

    const { data, error } = await query;
    if (error) throw error;

    const result: StandardsData = {
      u15: { men: [], women: [] },
      youth: { men: [], women: [] },
      junior: { men: [], women: [] },
      senior: { men: [], women: [] },
    };

    const rows = (data || []) as StandardsRow[];
    rows.forEach((row) => {
      const ageKey = row.age_category as keyof StandardsData;
      const genderKey = row.gender as 'men' | 'women';
      if (!result[ageKey] || !result[ageKey][genderKey]) return;
      result[ageKey][genderKey].push({
        weightClass: row.weight_class,
        a: row.standard_a,
        b: row.standard_b,
      });
    });

    // Custom sort: lowest to highest, '+' always last
    function weightClassSort(a: string, b: string): number {
      const parse = (w: string) => {
        if (w.startsWith('+')) return Infinity;
        const num = parseInt(w);
        return isNaN(num) ? Infinity : num;
      };
      const aVal = parse(a);
      const bVal = parse(b);
      if (aVal === bVal) return 0;
      if (aVal === Infinity) return 1;
      if (bVal === Infinity) return -1;
      return aVal - bVal;
    }

    // Sort weight classes for consistency (lowest to highest, '+' last)
    Object.values(result).forEach((group) => {
      group.men.sort((a, b) => weightClassSort(a.weightClass, b.weightClass));
      group.women.sort((a, b) => weightClassSort(a.weightClass, b.weightClass));
    });

    if (!ageGroup && !gender) {
      await setOfflineCache(cacheKey, result);
    }

    return result;
  } catch (error) {
    const cached = await getOfflineCache<StandardsData>(cacheKey);
    if (cached?.data) {
      return cached.data;
    }
    throw error;
  }
}
