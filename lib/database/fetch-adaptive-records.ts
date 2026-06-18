import { createMutableResource } from '@/lib/data/mutable-resource';
import { RecordsData, WeightClassRecord } from '@/types/records';
import { isNetworkAvailable } from '@/lib/networkUtils';
import { getOfflineCache, OFFLINE_CACHE_KEYS, setOfflineCache } from './offline-cache';
import { getJson } from '@/lib/api/meetcal-api';

type Gender = 'Men' | 'Women';

type AdaptiveRecordRow = {
  weight_class: string;
  snatch: number | null;
  cj: number | null;
  total: number | null;
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

async function fetchAdaptiveRecordsForGender(gender: Gender): Promise<WeightClassRecord[]> {
  const rows = await getJson<AdaptiveRecordRow[]>('/data/adaptive', {
    exclude_federation: 'BWL',
    gender,
  });
  const records = rows.map((row) => ({
    weightClass: row.weight_class.endsWith('kg') ? row.weight_class : `${row.weight_class}kg`,
    snatchRecord: row.snatch ?? 0,
    cjRecord: row.cj ?? 0,
    totalRecord: row.total ?? 0,
  }));

  records.sort((a, b) => weightClassSort(a.weightClass, b.weightClass));
  return records;
}

export async function fetchAdaptiveRecords(gender?: Gender, ageGroup?: string): Promise<RecordsData> {
  try {
    const result = await fetchAdaptiveRecordsFresh(gender, ageGroup);
    if (!gender && !ageGroup) {
      await persistAdaptiveRecords(result);
    }
    return result;
  } catch (error) {
    const cached = await readAdaptiveRecordsCache(ageGroup);
    if (cached?.data) {
      return cached.data;
    }
    throw error;
  }
}

async function readAdaptiveRecordsCache(ageGroup?: string) {
  const cached = await getOfflineCache<RecordsData>(OFFLINE_CACHE_KEYS.adaptiveRecords);
  if (!cached?.data) return null;
  if (ageGroup && !cached.data[ageGroup]) {
    return {
      data: { [ageGroup]: cached.data[AGE_GROUP_KEY] || { Men: [], Women: [] } },
      lastUpdatedAt: cached.lastSynced,
    };
  }
  return { data: cached.data, lastUpdatedAt: cached.lastSynced };
}

async function fetchAdaptiveRecordsFresh(gender?: Gender, ageGroup?: string): Promise<RecordsData> {
  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) {
    throw new Error('Offline');
  }

  const ageGroupKey = ageGroup || AGE_GROUP_KEY;
  const result: RecordsData = {
    [ageGroupKey]: { Men: [], Women: [] },
  };

  if (gender) {
    result[ageGroupKey][gender] = await fetchAdaptiveRecordsForGender(gender);
    return result;
  }

  const [menRecords, womenRecords] = await Promise.all([
    fetchAdaptiveRecordsForGender('Men'),
    fetchAdaptiveRecordsForGender('Women'),
  ]);
  result[ageGroupKey].Men = menRecords;
  result[ageGroupKey].Women = womenRecords;
  return result;
}

async function persistAdaptiveRecords(data: RecordsData) {
  const entry = await setOfflineCache(OFFLINE_CACHE_KEYS.adaptiveRecords, data);
  return { data: entry.data, lastUpdatedAt: entry.lastSynced };
}

export const adaptiveRecordsResource = createMutableResource<RecordsData, []>({
  getKey: () => OFFLINE_CACHE_KEYS.adaptiveRecords,
  loadCached: () => readAdaptiveRecordsCache(),
  fetchFresh: () => fetchAdaptiveRecordsFresh(),
  persistFresh: (data) => persistAdaptiveRecords(data),
});
