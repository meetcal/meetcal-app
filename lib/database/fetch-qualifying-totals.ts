import { api } from '@/convex/_generated/api';
import { convex } from '@/lib/convex';
import { createMutableResource } from '@/lib/data/mutable-resource';
import { isNetworkAvailable } from '@/lib/networkUtils';
import { getOfflineCache, OFFLINE_CACHE_KEYS, setOfflineCache } from './offline-cache';

export type QualifyingTotal = {
  id: number;
  eventName: string;
  gender: 'Men' | 'Women';
  ageCategory: string;
  weightClass: string;
  qualifyingTotal: number;
};

export type QualifyingTotalsData = {
  [eventName: string]: {
    [ageCategory: string]: {
      Men: { [weightClass: string]: number };
      Women: { [weightClass: string]: number };
    };
  };
};

type QualifyingTotalRow = {
  eventName: string;
  ageCategory: string;
  gender: 'Men' | 'Women';
  weightClass: string;
  qualifyingTotal: number;
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

  const rows = await convex.query(api.qualifyingTotals.getAll, {}) as QualifyingTotalRow[];

  const result: QualifyingTotalsData = {};
  rows.forEach((row) => {
    const e = row.eventName;
    const a = row.ageCategory;
    const g = row.gender;
    const w = row.weightClass;
    if (!result[e]) result[e] = {};
    if (!result[e][a]) result[e][a] = { Men: {}, Women: {} };
    result[e][a][g][w] = row.qualifyingTotal;
  });

  return result;
}

async function persistQualifyingTotals(
  data: QualifyingTotalsData,
) {
  const entry = await setOfflineCache(OFFLINE_CACHE_KEYS.qualifyingTotals, data);
  return { data: entry.data, lastUpdatedAt: entry.lastSynced };
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
