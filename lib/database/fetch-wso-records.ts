import { supabase } from '@/lib/supabase';
import { RecordsData } from '@/types/records';

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
 * Fetches records data from Supabase for a given WSO and organizes it into the RecordsData shape.
 * If ageGroup and gender are provided, fetches only that subset.
 */
export async function fetchWSORecords(
  wso: string,
  ageGroup?: string,
  gender?: 'Men' | 'Women'
): Promise<RecordsData> {
  let query = supabase
    .from('wso_records')
    .select('*')
    .eq('wso', wso);
  if (ageGroup) query = query.eq('age_category', ageGroup);
  if (gender) query = query.eq('gender', gender);

  const { data, error } = await query;
  if (error) throw error;

  // Find all unique age groups and genders in this data
  const ageGroups = Array.from(new Set((data || []).map(row => row.age_category)));
  const genders = ['Men', 'Women'];

  // Initialize result shape
  const result: RecordsData = {} as any;
  ageGroups.forEach((g) => {
    result[g] = { Men: [], Women: [] };
  });

  (data || []).forEach((row) => {
    const ageKey = row.age_category;
    const genderKey = row.gender;
    if (!result[ageKey] || !result[ageKey][genderKey]) return;
    result[ageKey][genderKey].push({
      weightClass: row.weight_class,
      snatchRecord: row.snatch_record ?? 0,
      cjRecord: row.cj_record ?? 0,
      totalRecord: row.total_record ?? 0,
    });
  });

  // Sort weight classes for consistency (lowest to highest, '+' last)
  Object.values(result).forEach((group: any) => {
    group.Men.sort((a: any, b: any) => weightClassSort(a.weightClass, b.weightClass));
    group.Women.sort((a: any, b: any) => weightClassSort(a.weightClass, b.weightClass));
  });

  return result;
}
