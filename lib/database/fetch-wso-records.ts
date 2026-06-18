import { createMutableResource } from '@/lib/data/mutable-resource';
import { RecordsData, AgeGroupRecords, WeightClassRecord } from '@/types/records';
import { isNetworkAvailable } from '@/lib/networkUtils';
import { getOfflineCache, OFFLINE_CACHE_KEYS, setOfflineCache } from './offline-cache';
import { fetchApiWsoAgeGroups, fetchApiWsoList, getJson } from '@/lib/api/meetcal-api';

type WSORecordsCache = Record<string, RecordsData>;
type FilteredWSORecordsCache = Record<string, RecordsData>;
type WSORecordRow = {
  age_category: string;
  gender: string;
  weight_class: string;
  snatch_record: number | null;
  cj_record: number | null;
  total_record: number | null;
  wso: string;
};

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

async function readWSOCache() {
  return await getOfflineCache<WSORecordsCache>(OFFLINE_CACHE_KEYS.wsoRecords);
}

async function readFilteredWSOCache() {
  return await getOfflineCache<FilteredWSORecordsCache>(
    OFFLINE_CACHE_KEYS.wsoRecordsFiltered,
  );
}

function getFilteredCacheKey(wso: string, ageGroup?: string, gender?: 'Men' | 'Women') {
  return [wso, ageGroup || '', gender || ''].join(':');
}

async function readWSORecordsCache(wso: string) {
  const cached = await readWSOCache();
  const data = cached?.data?.[wso];
  return data ? { data, lastUpdatedAt: cached.lastSynced } : null;
}

function filterRecordsData(
  data: RecordsData,
  ageGroup?: string,
  gender?: 'Men' | 'Women',
): RecordsData {
  if (!ageGroup && !gender) return data;

  const result: RecordsData = {};
  Object.entries(data).forEach(([group, records]) => {
    if (ageGroup && group !== ageGroup) return;

    result[group] = {
      Men: gender && gender !== 'Men' ? [] : records.Men,
      Women: gender && gender !== 'Women' ? [] : records.Women,
    };
  });

  return result;
}

async function readFilteredWSORecordsCache(
  wso: string,
  ageGroup?: string,
  gender?: 'Men' | 'Women',
) {
  const filteredCache = await readFilteredWSOCache();
  const filteredData = filteredCache?.data?.[getFilteredCacheKey(wso, ageGroup, gender)];
  if (filteredData) {
    return { data: filteredData, lastUpdatedAt: filteredCache.lastSynced };
  }

  const cached = await readWSORecordsCache(wso);
  return cached
    ? {
        data: filterRecordsData(cached.data, ageGroup, gender),
        lastUpdatedAt: cached.lastUpdatedAt,
      }
    : null;
}

async function fetchWSORecordsFresh(
  wso: string,
  ageGroup?: string,
  gender?: 'Men' | 'Women'
): Promise<RecordsData> {
  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) {
    throw new Error('Offline');
  }

  const rows = await getJson<WSORecordRow[]>('/data/wso/records', {
    wso,
    age_category: ageGroup,
    gender,
  });

  const ageGroups = Array.from(new Set(rows.map((row) => row.age_category)));

  const result: RecordsData = {};
  ageGroups.forEach((g) => {
    result[g] = { Men: [], Women: [] };
  });

  rows.forEach((row) => {
    const ageKey = row.age_category;
    const genderKey = row.gender as 'Men' | 'Women';
    if (!result[ageKey]) return;
    if (genderKey !== 'Men' && genderKey !== 'Women') return;

    result[ageKey][genderKey].push({
      weightClass: row.weight_class,
      snatchRecord: row.snatch_record ?? 0,
      cjRecord: row.cj_record ?? 0,
      totalRecord: row.total_record ?? 0,
    });
  });

  Object.values(result).forEach((group: AgeGroupRecords) => {
    group.Men.sort((a: WeightClassRecord, b: WeightClassRecord) => weightClassSort(a.weightClass, b.weightClass));
    group.Women.sort((a: WeightClassRecord, b: WeightClassRecord) => weightClassSort(a.weightClass, b.weightClass));
  });

  return result;
}

async function fetchWSOListFresh(): Promise<string[]> {
  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) {
    throw new Error('Offline');
  }

  return fetchApiWsoList();
}

async function persistWSORecords(wso: string, result: RecordsData) {
  const cached = await readWSOCache();
  const nextCache: WSORecordsCache = {
    ...(cached?.data || {}),
    [wso]: result,
  };
  const entry = await setOfflineCache(OFFLINE_CACHE_KEYS.wsoRecords, nextCache);
  return { data: result, lastUpdatedAt: entry.lastSynced };
}

async function persistFilteredWSORecords(
  wso: string,
  ageGroup: string,
  gender: 'Men' | 'Women',
  result: RecordsData,
) {
  const cached = await readFilteredWSOCache();
  const nextCache: FilteredWSORecordsCache = {
    ...(cached?.data || {}),
    [getFilteredCacheKey(wso, ageGroup, gender)]: result,
  };
  const entry = await setOfflineCache(
    OFFLINE_CACHE_KEYS.wsoRecordsFiltered,
    nextCache,
  );
  return { data: result, lastUpdatedAt: entry.lastSynced };
}

export const wsoRecordsResource = createMutableResource<RecordsData, [string, string, 'Men' | 'Women']>({
  getKey: (wso, ageGroup, gender) => `${OFFLINE_CACHE_KEYS.wsoRecords}:${wso}:${ageGroup}:${gender}`,
  loadCached: (wso, ageGroup, gender) => readFilteredWSORecordsCache(wso, ageGroup, gender),
  fetchFresh: (wso, ageGroup, gender) => fetchWSORecordsFresh(wso, ageGroup, gender),
  persistFresh: (data, wso, ageGroup, gender) => {
    if (ageGroup || gender) {
      return persistFilteredWSORecords(wso, ageGroup, gender, data);
    }
    return persistWSORecords(wso, data);
  },
});

export const wsoListResource = createMutableResource<string[], []>({
  getKey: () => `${OFFLINE_CACHE_KEYS.wsoRecords}:list`,
  loadCached: async () => {
    const cached = await readWSOCache();
    const wsos = Object.keys(cached?.data || {}).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );
    return wsos.length > 0
      ? { data: wsos, lastUpdatedAt: cached?.lastSynced ?? null }
      : null;
  },
  fetchFresh: () => fetchWSOListFresh(),
  persistFresh: async () => null,
});

export async function fetchWSORecords(
  wso: string,
  ageGroup?: string,
  gender?: 'Men' | 'Women'
): Promise<RecordsData> {
  try {
    const result = await fetchWSORecordsFresh(wso, ageGroup, gender);
    if (!ageGroup && !gender) {
      await persistWSORecords(wso, result);
    }
    return result;
  } catch (error) {
    const cached = await readWSORecordsCache(wso);
    if (cached?.data) {
      return cached.data;
    }
    throw error;
  }
}

export async function fetchWSOList(): Promise<string[]> {
  try {
    return await fetchWSOListFresh();
  } catch (error) {
    const cached = await readWSOCache();
    const wsos = Object.keys(cached?.data || {}).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );
    if (wsos.length > 0) {
      return wsos;
    }
    throw error;
  }
}

export async function fetchWSOAgeGroups(wso: string): Promise<string[]> {
  if (!wso) return [];

  try {
    const ageGroups = await fetchApiWsoAgeGroups(wso);
    return ageGroups;
  } catch (error) {
    const cached = await readWSORecordsCache(wso);
    if (cached?.data) {
      return Object.keys(cached.data);
    }
    throw error;
  }
}
