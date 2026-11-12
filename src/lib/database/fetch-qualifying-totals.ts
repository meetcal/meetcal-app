import { readQualifyingTotalsData } from './cached-shapes';
import { createMutableResource } from '@/lib/data/mutable-resource';
import {
  getOfflineCache,
  OFFLINE_CACHE_KEYS,
  replaceOfflineCache,
  setOfflineCache,
} from './offline-cache';
import { fetchApiQualifyingTotalsTagged, type ApiQualifyingTotalRow } from '@/lib/api/reference-api';
import { mapTagged, requireNetwork, resourceEntry, untagged } from './tagged-read';


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
  return resourceEntry(await getOfflineCache(cacheKey, readQualifyingTotalsData));
}

async function fetchQualifyingTotalsTagged(knownTag: string | null) {
  await requireNetwork();
  return mapTagged(await fetchApiQualifyingTotalsTagged(knownTag), mapQualifyingTotals);
}

function fetchQualifyingTotalsFresh(): Promise<QualifyingTotalsData> {
  return untagged(fetchQualifyingTotalsTagged(null), '/data/qualifying-totals');
}

function mapQualifyingTotals(rows: readonly Readonly<ApiQualifyingTotalRow>[]): QualifyingTotalsData {
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

/**
 * No qualifying total in any event (an event is only added with a row in it,
 * so no events means no rows). Neither the explicit download nor the browse
 * path (which writes to the download's key) stores such an answer: it would
 * replace a real download with nothing. The screen still shows the empty
 * answer; the stored copy stays.
 */
export const EMPTY_QUALIFYING_TOTALS: QualifyingTotalsData = {};

export function isQualifyingTotalsDataEmpty(data: QualifyingTotalsData): boolean {
  return Object.keys(data).length === 0;
}

async function persistQualifyingTotals(data: QualifyingTotalsData, tag: string | null) {
  if (isQualifyingTotalsDataEmpty(data)) return null;
  return resourceEntry(await setOfflineCache(OFFLINE_CACHE_KEYS.qualifyingTotals, data, tag));
}

/**
 * Explicit offline download / refresh: fresh from the API and stored, or a
 * rejection that leaves the stored copy untouched. Never the cached fallback.
 */
export async function downloadQualifyingTotalsForOffline(): Promise<void> {
  const data = await fetchQualifyingTotalsFresh();
  if (isQualifyingTotalsDataEmpty(data)) {
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
  persistFresh: (data) => persistQualifyingTotals(data, null),
  tagged: {
    fetch: (knownTag) => fetchQualifyingTotalsTagged(knownTag),
    persist: (data, tag) => persistQualifyingTotals(data, tag),
  },
});
