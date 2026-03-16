import { convex } from '@/lib/convex';
import { api } from '@/convex/_generated/api';
import { createMutableResource } from '@/lib/data/mutable-resource';
import { RecordsData, AgeGroupRecords, WeightClassRecord } from '@/types/records';
import { isNetworkAvailable } from '@/lib/networkUtils';
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

async function readWSORecordsCache(wso: string) {
  const cached = await readWSOCache();
  const data = cached?.data?.[wso];
  return data ? { data, lastUpdatedAt: cached.lastSynced } : null;
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

  return result;
}

async function fetchWSOListFresh(): Promise<string[]> {
  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) {
    throw new Error('Offline');
  }

  return await convex.query(api.wsoRecords.listWsos, {}) as string[];
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

export const wsoRecordsResource = createMutableResource<RecordsData, [string]>({
  getKey: (wso) => `${OFFLINE_CACHE_KEYS.wsoRecords}:${wso}`,
  loadCached: (wso) => readWSORecordsCache(wso),
  fetchFresh: (wso) => fetchWSORecordsFresh(wso),
  persistFresh: (data, wso) => persistWSORecords(wso, data),
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
    const rows = await fetchWSORecordsFresh(wso);
    return Object.keys(rows);
  } catch (error) {
    const cached = await readWSORecordsCache(wso);
    if (cached?.data) {
      return Object.keys(cached.data);
    }
    throw error;
  }
}
