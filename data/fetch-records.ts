import { supabase } from '@/lib/supabase';
import { RecordsData, AgeGroupRecords, WeightClassRecord } from '@/types/records';

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

/**
 * Fetches records data from Supabase for a given federation and organizes it into the RecordsData shape.
 * If ageGroup and gender are provided, fetches only that subset.
 */
export async function fetchRecords(
  federation: 'USAW' | 'USAMW' = 'USAW',
  ageGroup?: string,
  gender?: 'men' | 'women'
): Promise<RecordsData> {
  let query = supabase
    .from('records')
    .select('*')
    .eq('record_type', federation);
  if (ageGroup) query = query.eq('age_category', ageGroup);
  if (gender) query = query.eq('gender', gender);

  const { data, error } = await query;

  if (error) throw error;

  // Known age groups (USAW and USAMW)
  const ageGroups = federation === 'USAW'
    ? [
        'u13', 'u15', 'u17', 'collegiate', 'junior', 'senior',
        'Masters 35-39', 'Masters 40-44', 'Masters 45-49', 'Masters 50-54',
        'Masters 55-59', 'Masters 60-64', 'Masters 65-69', 'Masters 70-74',
        'Masters 75-79', 'Masters 80-84', 'Masters 85-89', 'Masters +90'
      ]
    : [
        'Masters 35-39', 'Masters 40-44', 'Masters 45-49', 'Masters 50-54',
        'Masters 55-59', 'Masters 60-64', 'Masters 65-69', 'Masters 70-74',
        'Masters 75-79', 'Masters 80-84', 'Masters 85-89', 'Masters +90'
      ];

  // Initialize result shape
  const result: RecordsData = Object.fromEntries(
    ageGroups.map((g) => [g, { men: [], women: [] }])
  ) as RecordsData;

  (data || []).forEach((row) => {
    const ageKey = row.age_category as keyof RecordsData;
    const genderKey = row.gender as 'men' | 'women';
    if (!result[ageKey] || !result[ageKey][genderKey]) return;
    result[ageKey][genderKey].push({
      weightClass: row.weight_class,
      snatchRecord: row.snatch_record ?? 0,
      cjRecord: row.cj_record ?? 0,
      totalRecord: row.total_record ?? 0,
    });
  });

  // Sort weight classes for consistency (lowest to highest, '+' last)
  Object.values(result).forEach((group) => {
    group.men.sort((a, b) => weightClassSort(a.weightClass, b.weightClass));
    group.women.sort((a, b) => weightClassSort(a.weightClass, b.weightClass));
  });

  return result;
}
