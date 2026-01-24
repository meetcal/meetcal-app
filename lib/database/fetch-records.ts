import { supabase } from '@/lib/supabase';
import { RecordsData, AgeGroupRecords, WeightClassRecord } from '@/types/records';
import { getOfflineCache, OFFLINE_CACHE_KEYS, setOfflineCache } from './offline-cache';

type RecordsCache = Record<string, RecordsData>;
type RecordsRow = {
  age_category: string;
  gender: 'men' | 'women';
  weight_class: string;
  snatch_record: number | null;
  cj_record: number | null;
  total_record: number | null;
  record_type: string;
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
 * Fetches records data from Supabase for a given federation and organizes it into the RecordsData shape.
 * If ageGroup and gender are provided, fetches only that subset.
 */
export async function fetchRecords(
  federation: string = 'USAW',
  ageGroup?: string,
  gender?: 'Men' | 'Women'
): Promise<RecordsData> {
  const cacheKey = OFFLINE_CACHE_KEYS.records;

  try {
    let query = supabase
      .from('records')
      .select('*')
      .eq('record_type', federation);
    if (ageGroup) query = query.eq('age_category', ageGroup);
    if (gender) query = query.eq('gender', gender.toLowerCase());

    const { data, error } = await query;

    if (error) throw error;

    // Initialize result shape dynamically
    const result: RecordsData = {};

    const rows = (data || []) as RecordsRow[];
    rows.forEach((row) => {
      const ageKey = row.age_category as string;
      const genderKey = row.gender as 'men' | 'women';

      // Ensure the age group object exists with the correct (capitalized) structure
      if (!result[ageKey]) {
        result[ageKey] = { Men: [], Women: [] };
      }
      
      // Map the lowercase DB value to the uppercase property in our standardized object
      const genderProp = genderKey === 'men' ? 'Men' : 'Women';
      
      result[ageKey][genderProp].push({
        weightClass: row.weight_class,
        snatchRecord: row.snatch_record ?? 0,
        cjRecord: row.cj_record ?? 0,
        totalRecord: row.total_record ?? 0,
      });
    });

    // Sort weight classes for consistency (lowest to highest, '+' last)
    Object.values(result).forEach((group) => {
      group.Men.sort((a, b) => weightClassSort(a.weightClass, b.weightClass));
      group.Women.sort((a, b) => weightClassSort(a.weightClass, b.weightClass));
    });

    if (!ageGroup && !gender) {
      const cached = await getOfflineCache<RecordsCache>(cacheKey);
      const nextCache: RecordsCache = {
        ...(cached?.data || {}),
        [federation]: result
      };
      await setOfflineCache(cacheKey, nextCache);
    }

    return result;
  } catch (error) {
    const cached = await getOfflineCache<RecordsCache>(cacheKey);
    const cachedFederation = cached?.data?.[federation];
    if (cachedFederation) {
      return cachedFederation;
    }
    throw error;
  }
}

export async function fetchFederations(): Promise<string[]> {
  const cacheKey = OFFLINE_CACHE_KEYS.records;

  try {
    const { data, error } = await supabase
      .from('records')
      .select('record_type', { count: 'exact', head: false });

    if (error) {
      console.error('Error fetching federations:', error);
      throw error;
    }

    // Get unique, non-null, sorted record_type values
    const federationRows = (data || []) as Array<Pick<RecordsRow, 'record_type'>>;
    const federations = Array.from(new Set(federationRows.map(row => row.record_type)))
      .filter(Boolean) 
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    
    return federations as string[];
  } catch (error) {
    const cached = await getOfflineCache<RecordsCache>(cacheKey);
    const federations = Object.keys(cached?.data || {});
    if (federations.length > 0) {
      return federations.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }
    throw error;
  }
}

// Helper for sorting age groups
function ageGroupSort(a: string, b: string): number {
  const order = ['u11', 'u13', 'u15', 'u17', 'youth', 'collegiate', 'junior', 'senior'];
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  const aIdx = order.indexOf(aLower);
  const bIdx = order.indexOf(bLower);

  if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
  if (aIdx !== -1) return -1;
  if (bIdx !== -1) return 1;

  // Masters sort (e.g., "Masters 35-39", "Masters 90+", "Masters +90")
  const mastersRegex = /^masters (?:\+)?(\d{2})(?:-(\d{2})|\+)?$/i;
  
  const matchA = aLower.match(mastersRegex);
  const matchB = bLower.match(mastersRegex);

  if (matchA && matchB) {
    // matchA[1] will capture the first number (e.g., "35" from "35-39", "90" from "90+", or "90" from "+90")
    const numA = parseInt(matchA[1]);
    const numB = parseInt(matchB[1]);
    return numA - numB;
  }
  if (matchA) return 1; // Masters typically come after non-masters if not in order array
  if (matchB) return -1;
  
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

export async function fetchAgeGroups(federation: string): Promise<string[]> {
  if (!federation) return [];
  const cacheKey = OFFLINE_CACHE_KEYS.records;

  try {
    const { data, error } = await supabase
      .from('records')
      .select('age_category')
      .eq('record_type', federation)
      .neq('age_category', null);

    if (error) {
      console.error(`Error fetching age groups for ${federation}:`, error);
      throw error;
    }

    const ageGroupRows = (data || []) as Array<Pick<RecordsRow, 'age_category'>>;
    const ageGroups = Array.from(new Set(ageGroupRows.map(row => row.age_category)))
      .filter(Boolean) 
      .sort(ageGroupSort);
    
    return ageGroups as string[];
  } catch (error) {
    const cached = await getOfflineCache<RecordsCache>(cacheKey);
    const federationData = cached?.data?.[federation];
    if (federationData) {
      return Object.keys(federationData).sort(ageGroupSort);
    }
    throw error;
  }
}
