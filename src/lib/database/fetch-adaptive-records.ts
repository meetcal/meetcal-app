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
      snatchRecord: row.snatch,
      cjRecord: row.cj,
      totalRecord: row.total,
    }));

  records.sort((a, b) => weightClassSort(a.weightClass, b.weightClass));
  return records;
}

/**
 * One gender's adaptive records, every class the answer holds. USAW changes
 * its classes (Aug 1, 2026: men's 85 and 95 kg replaced 79, 88 and 94), so
 * the table lists what the season has records in rather than a fixed list.
 */
export function adaptiveRecordsFor(data: RecordsData, gender: Gender): WeightClassRecord[] {
  return data[AGE_GROUP_KEY]?.[gender] ?? [];
}

async function readAdaptiveRecordsCache() {
  const cached = await getOfflineCache<RecordsData>(OFFLINE_CACHE_KEYS.adaptiveRecords);
  if (!cached?.data) return null;
  return { data: cached.data, lastUpdatedAt: cached.lastSynced };
}

async function fetchAdaptiveRecordsFresh(): Promise<RecordsData> {
  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) {
    throw new Error('Offline');
  }

  const [menRecords, womenRecords] = await Promise.all([
    fetchAdaptiveRecordsForGender('Men'),
    fetchAdaptiveRecordsForGender('Women'),
  ]);
  return { [AGE_GROUP_KEY]: { Men: menRecords, Women: womenRecords } };
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
  // An empty table would replace a real download with nothing.
  const { Men, Women } = data[AGE_GROUP_KEY];
  if (Men.length + Women.length === 0) {
    throw new Error('Adaptive records download returned no rows');
  }
  await replaceOfflineCache(OFFLINE_CACHE_KEYS.adaptiveRecords, data);
}

export const adaptiveRecordsResource = createMutableResource<RecordsData, []>({
  getKey: () => OFFLINE_CACHE_KEYS.adaptiveRecords,
  loadCached: () => readAdaptiveRecordsCache(),
  fetchFresh: () => fetchAdaptiveRecordsFresh(),
  persistFresh: (data) => persistAdaptiveRecords(data),
});
