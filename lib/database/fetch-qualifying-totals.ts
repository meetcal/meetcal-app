import { convex } from '@/lib/convex';
import { api } from '@/convex/_generated/api';
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

const totalsMemoryCache: { data: QualifyingTotalsData | null } = { data: null };
const inFlightTotals = new Map<string, Promise<QualifyingTotalsData>>();

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

/**
 * Fetches qualifying totals from Supabase. If eventName, ageCategory, gender, or weightClass are provided,
 * fetches only that subset. Otherwise, fetches all.
 */
export async function fetchQualifyingTotals(
  eventName?: string,
  ageCategory?: string,
  gender?: 'Men' | 'Women',
  weightClass?: string
): Promise<QualifyingTotalsData> {
  const requestKey = `${eventName || '*'}::${ageCategory || '*'}::${gender || '*'}::${weightClass || '*'}`;
  if (totalsMemoryCache.data) {
    return filterTotals(totalsMemoryCache.data, eventName, ageCategory, gender, weightClass);
  }
  if (inFlightTotals.has(requestKey)) {
    return inFlightTotals.get(requestKey)!;
  }

  const cacheKey = OFFLINE_CACHE_KEYS.qualifyingTotals;
  const request = (async () => {
    try {
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

      if (!eventName && !ageCategory && !gender && !weightClass) {
        totalsMemoryCache.data = result;
        await setOfflineCache(cacheKey, result);
      }

      return result;
    } catch (error) {
      const cached = await getOfflineCache<QualifyingTotalsData>(cacheKey);
      if (cached?.data) {
        totalsMemoryCache.data = cached.data;
        return filterTotals(cached.data, eventName, ageCategory, gender, weightClass);
      }
      throw error;
    } finally {
      inFlightTotals.delete(requestKey);
    }
  })();

  inFlightTotals.set(requestKey, request);
  return request;
}
