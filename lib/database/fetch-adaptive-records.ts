import { createMutableResource } from '@/lib/data/mutable-resource';
import { RecordsData, WeightClassRecord } from '@/types/records';
import { isNetworkAvailable } from '@/lib/networkUtils';
import {
  getOfflineCache,
  OFFLINE_CACHE_KEYS,
  replaceOfflineCache,
  setOfflineCache,
} from './offline-cache';
import { fetchApiAdaptiveRecords, type ApiAdaptiveRecordRow } from '@/lib/api/meetcal-api';
import { weightClassSort } from './weight-class-sort';

type Gender = 'Men' | 'Women';

const AGE_GROUP_KEY = 'Adaptive';

async function fetchAdaptiveRecordsForGender(gender: Gender): Promise<WeightClassRecord[]> {
  const rows = await fetchApiAdaptiveRecords(gender, 'BWL');
  // `weight_class` is nullable in the source table and it is this row's only
  // identity; `.endsWith` on a null one threw and lost the whole gender's
  // records rather than the single bad row.
  const records = rows
    .filter((row): row is Readonly<ApiAdaptiveRecordRow> & { weight_class: string } =>
      Boolean(row.weight_class),
    )
    .map((row) => ({
      weightClass: row.weight_class.endsWith('kg')
        ? row.weight_class
        : `${row.weight_class}kg`,
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

/**
 * Explicit offline download / refresh: fresh from the API and stored, or a
 * rejection that leaves the stored copy untouched. Never the cached fallback.
 */
export async function downloadAdaptiveRecordsForOffline(): Promise<void> {
  const data = await fetchAdaptiveRecordsFresh();
  await replaceOfflineCache(OFFLINE_CACHE_KEYS.adaptiveRecords, data);
}

export const adaptiveRecordsResource = createMutableResource<RecordsData, []>({
  getKey: () => OFFLINE_CACHE_KEYS.adaptiveRecords,
  loadCached: () => readAdaptiveRecordsCache(),
  fetchFresh: () => fetchAdaptiveRecordsFresh(),
  persistFresh: (data) => persistAdaptiveRecords(data),
});
