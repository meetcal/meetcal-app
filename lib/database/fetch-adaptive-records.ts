import { convex } from '@/lib/convex';
import { api } from '@/convex/_generated/api';
import { RecordsData, WeightClassRecord } from '@/types/records';
import { getOfflineCache, OFFLINE_CACHE_KEYS, setOfflineCache } from './offline-cache';

type Gender = 'Men' | 'Women';

type AdaptiveRecordRow = {
  age: string | null;
  snatchBest: number | null;
  cjBest: number | null;
  total: number | null;
  name: string | null;
};

const AGE_GROUP_KEY = 'Adaptive';
const adaptiveMemoryCache = new Map<string, RecordsData>();
const adaptiveInFlight = new Map<string, Promise<RecordsData>>();

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
  const allAdaptive = await convex.query(api.liftingResults.getAdaptive, { excludeFederation: 'BWL' });
  const rows = allAdaptive.filter(r => r.age && r.age.includes(gender)) as AdaptiveRecordRow[];
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
    snatchRecord: row.snatchBest ?? 0,
    cjRecord: row.cjBest ?? 0,
    totalRecord: row.total ?? 0,
  }));

  records.sort((a, b) => weightClassSort(a.weightClass, b.weightClass));
  return records;
}

export async function fetchAdaptiveRecords(gender?: Gender, ageGroup?: string): Promise<RecordsData> {
  const cacheKey = OFFLINE_CACHE_KEYS.adaptiveRecords;
  const ageGroupKey = ageGroup || AGE_GROUP_KEY;
  const requestKey = `${gender || 'all'}::${ageGroupKey}`;

  const cached = adaptiveMemoryCache.get(requestKey);
  if (cached) {
    return cached;
  }

  const inFlight = adaptiveInFlight.get(requestKey);
  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
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

      adaptiveMemoryCache.set(requestKey, result);
      return result;
    } catch (error) {
      const cachedOffline = await getOfflineCache<RecordsData>(cacheKey);
      if (cachedOffline?.data) {
        if (ageGroup && !cachedOffline.data[ageGroup]) {
          const fallback = { [ageGroup]: cachedOffline.data[AGE_GROUP_KEY] || { Men: [], Women: [] } };
          adaptiveMemoryCache.set(requestKey, fallback);
          return fallback;
        }
        adaptiveMemoryCache.set(requestKey, cachedOffline.data);
        return cachedOffline.data;
      }
      throw error;
    } finally {
      adaptiveInFlight.delete(requestKey);
    }
  })();

  adaptiveInFlight.set(requestKey, request);
  return request;
}
