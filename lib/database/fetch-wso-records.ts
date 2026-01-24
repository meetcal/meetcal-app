import { supabase } from '@/lib/supabase';
import { RecordsData, AgeGroupRecords, WeightClassRecord } from '@/types/records';
import { getOfflineCache, OFFLINE_CACHE_KEYS, setOfflineCache } from './offline-cache';

type WSORecordsCache = Record<string, RecordsData>;
type WSORecordRow = {
  age_category: string;
  gender: 'Men' | 'Women';
  weight_class: string;
  snatch_record: number | null;
  cj_record: number | null;
  total_record: number | null;
  wso: string;
};

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
  const cacheKey = OFFLINE_CACHE_KEYS.wsoRecords;

  try {
    let query = supabase
      .from('wso_records')
      .select('*')
      .eq('wso', wso);
    if (ageGroup) query = query.eq('age_category', ageGroup);
    if (gender) query = query.eq('gender', gender);

    const { data, error } = await query;
    if (error) throw error;

    // Find all unique age groups in this data
    const rows = (data || []) as WSORecordRow[];
    const ageGroups = Array.from(new Set(rows.map(row => row.age_category)));

    // Initialize result shape
    const result: RecordsData = {};
    ageGroups.forEach((g) => {
      result[g] = { Men: [], Women: [] };
    });

    rows.forEach((row) => {
      const ageKey = row.age_category;
      const genderKey = row.gender as 'Men' | 'Women';
      if (!result[ageKey]) return;
      
      // Check if genderKey is a valid key, although `as` above should ensure it
      if (genderKey !== 'Men' && genderKey !== 'Women') return;
      
      result[ageKey][genderKey].push({
        weightClass: row.weight_class,
        snatchRecord: row.snatch_record ?? 0,
        cjRecord: row.cj_record ?? 0,
        totalRecord: row.total_record ?? 0,
      });
    });

    // Sort weight classes for consistency (lowest to highest, '+' last)
    Object.values(result).forEach((group: AgeGroupRecords) => {
      group.Men.sort((a: WeightClassRecord, b: WeightClassRecord) => weightClassSort(a.weightClass, b.weightClass));
      group.Women.sort((a: WeightClassRecord, b: WeightClassRecord) => weightClassSort(a.weightClass, b.weightClass));
    });

    if (!ageGroup && !gender) {
      const cached = await getOfflineCache<WSORecordsCache>(cacheKey);
      const nextCache: WSORecordsCache = {
        ...(cached?.data || {}),
        [wso]: result
      };
      await setOfflineCache(cacheKey, nextCache);
    }

    return result;
  } catch (error) {
    const cached = await getOfflineCache<WSORecordsCache>(cacheKey);
    const cachedWso = cached?.data?.[wso];
    if (cachedWso) {
      return cachedWso;
    }
    throw error;
  }
}

export async function fetchWSOList(): Promise<string[]> {
  const cacheKey = OFFLINE_CACHE_KEYS.wsoRecords;

  try {
    const { data, error } = await supabase
      .from('wso_records')
      .select('wso', { count: 'exact', head: false })
      .neq('wso', null);
    if (error) throw error;
    const wsoRows = (data || []) as Array<Pick<WSORecordRow, 'wso'>>;
    const wsos = Array.from(new Set(wsoRows.map(row => row.wso)))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return wsos as string[];
  } catch (error) {
    const cached = await getOfflineCache<WSORecordsCache>(cacheKey);
    const wsos = Object.keys(cached?.data || {});
    if (wsos.length > 0) {
      return wsos.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }
    throw error;
  }
}

export async function fetchWSOAgeGroups(wso: string): Promise<string[]> {
  const cacheKey = OFFLINE_CACHE_KEYS.wsoRecords;

  try {
    const { data, error } = await supabase
      .from('wso_records')
      .select('age_category', { count: 'exact', head: false })
      .eq('wso', wso)
      .neq('age_category', null);
    if (error) throw error;
    const ageGroupRows = (data || []) as Array<Pick<WSORecordRow, 'age_category'>>;
    return Array.from(new Set(ageGroupRows.map(row => row.age_category)));
  } catch (error) {
    const cached = await getOfflineCache<WSORecordsCache>(cacheKey);
    const cachedWso = cached?.data?.[wso];
    if (cachedWso) {
      return Object.keys(cachedWso);
    }
    throw error;
  }
}
