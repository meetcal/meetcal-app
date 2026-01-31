import { supabase } from '@/lib/supabase';
import { RecordsData, WeightClassRecord } from '@/types/records';
import { getOfflineCache, OFFLINE_CACHE_KEYS, setOfflineCache } from './offline-cache';

type Gender = 'Men' | 'Women';

type AdaptiveRecordRow = {
  id: number;
  age: string | null;
  snatch_best: number | null;
  cj_best: number | null;
  total: number | null;
  name: string | null;
};

const AGE_GROUP_KEY = 'Adaptive';

// Custom sort: lowest to highest, '+' always last
function weightClassSort(a: string, b: string): number {
  const parse = (w: string) => {
    if (w.includes('+')) return Infinity;
    const num = parseInt(w.replace(/[^\d]/g, ''), 10);
    return Number.isNaN(num) ? Infinity : num;
  };
  const aVal = parse(a);
  const bVal = parse(b);
  if (aVal === bVal) return 0;
  if (aVal === Infinity) return 1;
  if (bVal === Infinity) return -1;
  return aVal - bVal;
}

// Extract weight class from age column (e.g., "Women's Masters (35-39) 69kg" -> "69kg")
function extractWeightClass(ageString: string): string | null {
  const match = ageString.match(/(\d+\+?kg)$/i);
  return match ? match[1] : null;
}

async function fetchAdaptiveRecordsForGender(gender: Gender): Promise<WeightClassRecord[]> {
  const { data, error } = await supabase
    .from('lifting_results')
    .select('id, age, snatch_best, cj_best, total, name')
    .eq('adaptive', true)
    .neq('federation', 'BWL')
    .like('age', `%${gender}%`);

  if (error) throw error;

  const rows = (data || []) as AdaptiveRecordRow[];
  const weightClassRecords = new Map<string, AdaptiveRecordRow>();

  rows.forEach((row) => {
    if (!row.age) return;
    const weightClass = extractWeightClass(row.age);
    if (!weightClass) return;
    if (row.total == null) return;

    const existing = weightClassRecords.get(weightClass);
    if (!existing || (row.total ?? 0) > (existing.total ?? 0)) {
      weightClassRecords.set(weightClass, row);
    }
  });

  const records = Array.from(weightClassRecords.entries()).map(([weightClass, row]) => ({
    weightClass,
    snatchRecord: row.snatch_best ?? 0,
    cjRecord: row.cj_best ?? 0,
    totalRecord: row.total ?? 0,
  }));

  records.sort((a, b) => weightClassSort(a.weightClass, b.weightClass));
  return records;
}

export async function fetchAdaptiveRecords(gender?: Gender, ageGroup?: string): Promise<RecordsData> {
  const cacheKey = OFFLINE_CACHE_KEYS.adaptiveRecords;
  const ageGroupKey = ageGroup || AGE_GROUP_KEY;

  try {
    const result: RecordsData = {
      [ageGroupKey]: { Men: [], Women: [] },
    };

    if (gender) {
      result[ageGroupKey][gender] = await fetchAdaptiveRecordsForGender(gender);
    } else {
      const [menRecords, womenRecords] = await Promise.all([
        fetchAdaptiveRecordsForGender('Men'),
        fetchAdaptiveRecordsForGender('Women'),
      ]);
      result[ageGroupKey].Men = menRecords;
      result[ageGroupKey].Women = womenRecords;
    }

    if (!gender && !ageGroup) {
      await setOfflineCache(cacheKey, result);
    }

    return result;
  } catch (error) {
    const cached = await getOfflineCache<RecordsData>(cacheKey);
    if (cached?.data) {
      if (ageGroup && !cached.data[ageGroup]) {
        return { [ageGroup]: cached.data[AGE_GROUP_KEY] || { Men: [], Women: [] } };
      }
      return cached.data;
    }
    throw error;
  }
}
