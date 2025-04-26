import { supabase } from '@/lib/supabase';
import { StandardsData, AgeGroupStandards, StandardRecord } from '@/types/standards';

/**
 * Fetches standards data from Supabase and organizes it into the StandardsData shape.
 */
export async function fetchStandards(): Promise<StandardsData> {
  const { data, error } = await supabase
    .from('standards')
    .select('*');

  if (error) throw error;

  // Group and shape the data to fit StandardsData
  const result: StandardsData = {
    u15: { men: [], women: [] },
    youth: { men: [], women: [] },
    junior: { men: [], women: [] },
    senior: { men: [], women: [] },
  };

  (data || []).forEach((row) => {
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

  return result;
}
