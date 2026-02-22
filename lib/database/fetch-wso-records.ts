import { convex } from '@/lib/convex';
import { api } from '@/convex/_generated/api';
import { RecordsData, AgeGroupRecords, WeightClassRecord } from '@/types/records';
import { getOfflineCache, OFFLINE_CACHE_KEYS, setOfflineCache } from './offline-cache';

type WSORecordsCache = Record<string, RecordsData>;
type WSORecordRow = {
  ageCategory: string;
  gender: 'Men' | 'Women';
  weightClass: string;
  snatchRecord: number | null;
  cjRecord: number | null;
  totalRecord: number | null;
  wso: string;
};

const wsoRecordsMemoryCache = new Map<string, RecordsData>();
const wsoListMemoryCache: { data: string[] | null } = { data: null };
const wsoAgeGroupsMemoryCache = new Map<string, string[]>();
const inFlightRequests = new Map<string, Promise<RecordsData>>();
let inFlightWSOList: Promise<string[]> | null = null;
const inFlightWSOAgeGroups = new Map<string, Promise<string[]>>();

// Custom sort: lowest to highest, '+' always last
function weightClassSort(a: string, b: string): number {
  const parse = (w: string) => {
    if (w.startsWith('+')) return Infinity;
    const num = parseInt(w);
    return isNaN(num) ? Infinity : num;
  };
  const aVal = parse(a);
  const bVal = parse(b);
  if (aVal === bVal) return 0;
  if (aVal === Infinity) return 1;
  if (bVal === Infinity) return -1;
  return aVal - bVal;
}

/**
 * Fetches records data from Convex for a given WSO and organizes it into the RecordsData shape.
 * If ageGroup and gender are provided, fetches only that subset.
 */
export async function fetchWSORecords(
  wso: string,
  ageGroup?: string,
  gender?: 'Men' | 'Women'
): Promise<RecordsData> {
  const requestKey = `${wso}::${ageGroup || '*'}::${gender || '*'}`;
  const memoryKey = ageGroup || gender ? null : wso;
  if (memoryKey && wsoRecordsMemoryCache.has(memoryKey)) {
    return wsoRecordsMemoryCache.get(memoryKey)!;
  }
  if (inFlightRequests.has(requestKey)) {
    return inFlightRequests.get(requestKey)!;
  }

  const cacheKey = OFFLINE_CACHE_KEYS.wsoRecords;
  const request = (async () => {
    try {
      const rows = (await convex.query(api.wsoRecords.getByWso, {
        wso,
        ageCategory: ageGroup,
        gender,
      })) as unknown as WSORecordRow[];

      const ageGroups = Array.from(new Set(rows.map((row) => row.ageCategory)));

      const result: RecordsData = {};
      ageGroups.forEach((g) => {
        result[g] = { Men: [], Women: [] };
      });

      rows.forEach((row) => {
        const ageKey = row.ageCategory;
        const genderKey = row.gender as 'Men' | 'Women';
        if (!result[ageKey]) return;
        if (genderKey !== 'Men' && genderKey !== 'Women') return;

        result[ageKey][genderKey].push({
          weightClass: row.weightClass,
          snatchRecord: row.snatchRecord ?? 0,
          cjRecord: row.cjRecord ?? 0,
          totalRecord: row.totalRecord ?? 0,
        });
      });

      Object.values(result).forEach((group: AgeGroupRecords) => {
        group.Men.sort((a: WeightClassRecord, b: WeightClassRecord) => weightClassSort(a.weightClass, b.weightClass));
        group.Women.sort((a: WeightClassRecord, b: WeightClassRecord) => weightClassSort(a.weightClass, b.weightClass));
      });

      if (!ageGroup && !gender) {
        wsoRecordsMemoryCache.set(wso, result);
        wsoAgeGroupsMemoryCache.set(wso, Object.keys(result));

        const cached = await getOfflineCache<WSORecordsCache>(cacheKey);
        const nextCache: WSORecordsCache = {
          ...(cached?.data || {}),
          [wso]: result
        };
        await setOfflineCache(cacheKey, nextCache);
      }

      return result;
    } catch (error) {
      const cached = await getOfflineCache<WSORecordsCache>(cacheKey);
      const cachedWso = cached?.data?.[wso];
      if (cachedWso) {
        if (!ageGroup && !gender) {
          wsoRecordsMemoryCache.set(wso, cachedWso);
          wsoAgeGroupsMemoryCache.set(wso, Object.keys(cachedWso));
        }
        return cachedWso;
      }
      throw error;
    } finally {
      inFlightRequests.delete(requestKey);
    }
  })();

  inFlightRequests.set(requestKey, request);
  return request;
}

export async function fetchWSOList(): Promise<string[]> {
  if (wsoListMemoryCache.data) {
    return wsoListMemoryCache.data;
  }
  if (inFlightWSOList) {
    return inFlightWSOList;
  }

  const cacheKey = OFFLINE_CACHE_KEYS.wsoRecords;
  inFlightWSOList = (async () => {
    try {
      const wsos = await convex.query(api.wsoRecords.listWsos, {}) as string[];
      wsoListMemoryCache.data = wsos;
      return wsos;
    } catch (error) {
      const cached = await getOfflineCache<WSORecordsCache>(cacheKey);
      const wsos = Object.keys(cached?.data || {});
      if (wsos.length > 0) {
        const sorted = wsos.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        wsoListMemoryCache.data = sorted;
        return sorted;
      }
      throw error;
    } finally {
      inFlightWSOList = null;
    }
  })();

  return inFlightWSOList;
}

export async function fetchWSOAgeGroups(wso: string): Promise<string[]> {
  if (wsoAgeGroupsMemoryCache.has(wso)) {
    return wsoAgeGroupsMemoryCache.get(wso)!;
  }
  if (inFlightWSOAgeGroups.has(wso)) {
    return inFlightWSOAgeGroups.get(wso)!;
  }

  const cacheKey = OFFLINE_CACHE_KEYS.wsoRecords;

  const request = (async () => {
    try {
      const rows = (await convex.query(api.wsoRecords.getByWso, { wso })) as unknown as WSORecordRow[];
      const ageGroups = Array.from(new Set(rows.map((r) => r.ageCategory))).filter(Boolean) as string[];
      wsoAgeGroupsMemoryCache.set(wso, ageGroups);
      return ageGroups;
    } catch (error) {
      const cached = await getOfflineCache<WSORecordsCache>(cacheKey);
      const cachedWso = cached?.data?.[wso];
      if (cachedWso) {
        const ageGroups = Object.keys(cachedWso);
        wsoAgeGroupsMemoryCache.set(wso, ageGroups);
        return ageGroups;
      }
      throw error;
    } finally {
      inFlightWSOAgeGroups.delete(wso);
    }
  })();

  inFlightWSOAgeGroups.set(wso, request);
  return request;
}
