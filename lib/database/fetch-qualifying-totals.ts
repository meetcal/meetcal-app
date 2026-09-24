import { createMutableResource } from '@/lib/data/mutable-resource';
import { isNetworkAvailable } from '@/lib/networkUtils';
import {
  getOfflineCache,
  OFFLINE_CACHE_KEYS,
  replaceOfflineCache,
  setOfflineCache,
} from './offline-cache';
import { fetchApiQualifyingTotals } from '@/lib/api/meetcal-api';


export type QualifyingTotalsData = {
  [eventName: string]: {
    [ageCategory: string]: {
      Men: { [weightClass: string]: number };
      Women: { [weightClass: string]: number };
    };
  };
};

function filterTotals(
  source: QualifyingTotalsData,
  eventName?: string,
  ageCategory?: string,
  gender?: 'Men' | 'Women',
  weightClass?: string
): QualifyingTotalsData {
  if (!eventName && !ageCategory && !gender && !weightClass) return source;

  const result: QualifyingTotalsData = {};
  const eventKeys = eventName ? [eventName] : Object.keys(source);

  eventKeys.forEach((eventKey) => {
    const eventData = source[eventKey];
    if (!eventData) return;
    const ageKeys = ageCategory ? [ageCategory] : Object.keys(eventData);

    ageKeys.forEach((ageKey) => {
      const ageData = eventData[ageKey];
      if (!ageData) return;

      if (!result[eventKey]) result[eventKey] = {};
      if (!result[eventKey][ageKey]) result[eventKey][ageKey] = { Men: {}, Women: {} };

      if (!gender || gender === 'Men') {
        result[eventKey][ageKey].Men = weightClass
          ? (ageData.Men[weightClass] != null ? { [weightClass]: ageData.Men[weightClass] } : {})
          : ageData.Men;
      }

      if (!gender || gender === 'Women') {
        result[eventKey][ageKey].Women = weightClass
          ? (ageData.Women[weightClass] != null ? { [weightClass]: ageData.Women[weightClass] } : {})
          : ageData.Women;
      }
    });
  });

  return result;
}

async function readQualifyingTotalsCache() {
  const cacheKey = OFFLINE_CACHE_KEYS.qualifyingTotals;
  const cached = await getOfflineCache<QualifyingTotalsData>(cacheKey);
  return cached
    ? { data: cached.data, lastUpdatedAt: cached.lastSynced }
    : null;
}

async function fetchQualifyingTotalsFresh(): Promise<QualifyingTotalsData> {
  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) {
    throw new Error('Offline');
  }

  const rows = await fetchApiQualifyingTotals();

  const result: QualifyingTotalsData = {};
  rows.forEach((row) => {
    const e = row.event_name;
    const a = row.age_category;
    const g = row.gender;
    const w = row.weight_class;
    if (typeof e !== 'string' || typeof a !== 'string' || typeof w !== 'string') return;
    // Only 'Men' and 'Women' buckets exist. Indexing with anything else
    // ("M", null, "Mixed") would blow up the whole payload on one bad row —
    // the same guard `fetch-wso-records` already applies.
    if (g !== 'Men' && g !== 'Women') return;
    if (typeof row.qualifying_total !== 'number') return;
    if (!result[e]) result[e] = {};
    if (!result[e][a]) result[e][a] = { Men: {}, Women: {} };
    result[e][a][g][w] = row.qualifying_total;
  });

  return result;
}

async function persistQualifyingTotals(
  data: QualifyingTotalsData,
) {
  const entry = await setOfflineCache(OFFLINE_CACHE_KEYS.qualifyingTotals, data);
  return { data: entry.data, lastUpdatedAt: entry.lastSynced };
}

/**
 * Explicit offline download / refresh: fresh from the API and stored, or a
 * rejection that leaves the stored copy untouched. Never the cached fallback.
 */
export async function downloadQualifyingTotalsForOffline(): Promise<void> {
  const data = await fetchQualifyingTotalsFresh();
  await replaceOfflineCache(OFFLINE_CACHE_KEYS.qualifyingTotals, data);
}

export const qualifyingTotalsResource = createMutableResource<
  QualifyingTotalsData,
  []
>({
  getKey: () => OFFLINE_CACHE_KEYS.qualifyingTotals,
  loadCached: () => readQualifyingTotalsCache(),
  fetchFresh: () => fetchQualifyingTotalsFresh(),
  persistFresh: (data) => persistQualifyingTotals(data),
});

export async function fetchQualifyingTotals(
  eventName?: string,
  ageCategory?: string,
  gender?: 'Men' | 'Women',
  weightClass?: string
): Promise<QualifyingTotalsData> {
  try {
    const result = await fetchQualifyingTotalsFresh();
    await persistQualifyingTotals(result);
    return filterTotals(result, eventName, ageCategory, gender, weightClass);
  } catch (error) {
    const cached = await readQualifyingTotalsCache();
    if (cached?.data) {
      return filterTotals(cached.data, eventName, ageCategory, gender, weightClass);
    }
    throw error;
  }
}
