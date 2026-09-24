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
  // An event is only added with a row in it, so no events means no rows. An
  // empty table would replace a real download with nothing.
  if (Object.keys(data).length === 0) {
    throw new Error('Qualifying totals download returned no rows');
  }
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
