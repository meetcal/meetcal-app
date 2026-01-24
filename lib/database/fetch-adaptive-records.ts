import { supabase } from '@/lib/supabase';
import { RecordsData } from '@/types/records';
import { getOfflineCache, OFFLINE_CACHE_KEYS, setOfflineCache } from './offline-cache';

type Gender = 'Men' | 'Women';
type AdaptiveRecordRow = {
  body_weight: number;
  snatch_best: number | null;
  cj_best: number | null;
  total: number | null;
};

// Weight class mappings for men and women
const MENS_WEIGHT_CLASSES = [55, 61, 67, 73, 81, 89, 96, 102, 109, 118, 145, Infinity];
const WOMENS_WEIGHT_CLASSES = [45, 49, 55, 59, 64, 71, 76, 81, 87, Infinity];

function getWeightClass(bodyWeight: number, gender: string): string {
  const classes = gender.toLowerCase() === 'men' ? MENS_WEIGHT_CLASSES : WOMENS_WEIGHT_CLASSES;
  
  for (const limit of classes) {
    if (bodyWeight <= limit) {
      return limit === Infinity ? `+${classes[classes.length - 2]}` : limit.toString();
    }
  }
  
  return `+${classes[classes.length - 2]}`;
}

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

export async function fetchAdaptiveRecords(gender?: Gender, ageGroup?: string): Promise<RecordsData> {
  const cacheKey = OFFLINE_CACHE_KEYS.adaptiveRecords;

  try {
    let query = supabase
      .from('lifting_results')
      .select('*')
      .eq('adaptive', true)
      .not('body_weight', 'is', null)
      .not('snatch_best', 'is', null)
      .not('cj_best', 'is', null)
      .not('total', 'is', null);

    const { data, error } = await query;

    if (error) throw error;

    // Group by weight class and calculate max lifts
    const weightClassGroups: { [key: string]: { [gender: string]: any[] } } = {};

    const rows = (data || []) as AdaptiveRecordRow[];
    rows.forEach((row) => {
      // Simple gender inference based on typical weight ranges
      // Men's weight classes typically go higher than women's
      const inferredGender = row.body_weight > 87 ? 'Men' : 'Women';
      
      if (gender && inferredGender !== gender) return; // Filter by gender if specified

      const weightClass = getWeightClass(row.body_weight, inferredGender);
      
      if (!weightClassGroups[weightClass]) {
        weightClassGroups[weightClass] = { Men: [], Women: [] };
      }
      
      weightClassGroups[weightClass][inferredGender].push(row);
    });

    // Calculate max records for each weight class
    // Use the provided age group or default to 'Adaptive'
    const ageGroupKey = ageGroup || 'Adaptive';
    const result: RecordsData = { [ageGroupKey]: { Men: [], Women: [] } };

    Object.entries(weightClassGroups).forEach(([weightClass, genderGroups]) => {
      ['Men', 'Women'].forEach((genderKey) => {
        const records = genderGroups[genderKey];
        if (records.length > 0) {
          const maxSnatch = Math.max(...records.map(r => r.snatch_best || 0));
          const maxCJ = Math.max(...records.map(r => r.cj_best || 0));
          const maxTotal = Math.max(...records.map(r => r.total || 0));

          result[ageGroupKey][genderKey as 'Men' | 'Women'].push({
            weightClass,
            snatchRecord: maxSnatch,
            cjRecord: maxCJ,
            totalRecord: maxTotal,
          });
        }
      });
    });

    // Sort weight classes
    result[ageGroupKey].Men.sort((a, b) => weightClassSort(a.weightClass, b.weightClass));
    result[ageGroupKey].Women.sort((a, b) => weightClassSort(a.weightClass, b.weightClass));

    if (!gender && !ageGroup) {
      await setOfflineCache(cacheKey, result);
    }

    return result;
  } catch (error) {
    const cached = await getOfflineCache<RecordsData>(cacheKey);
    if (cached?.data) {
      if (ageGroup && !cached.data[ageGroup]) {
        const firstKey = Object.keys(cached.data)[0];
        if (firstKey) {
          return { [ageGroup]: cached.data[firstKey] };
        }
      }
      return cached.data;
    }
    throw error;
  }
}
