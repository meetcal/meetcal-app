import { createMutableResource } from '@/lib/data/mutable-resource';
import { RecordsData } from '@/types/records';
import { isNetworkAvailable } from '@/lib/networkUtils';
import { getOfflineCache, OFFLINE_CACHE_KEYS, setOfflineCache } from './offline-cache';
import { getJson } from '@/lib/api/meetcal-api';

type RecordsCache = Record<string, RecordsData>;
type RecordsRow = {
  age_category: string | null;
  gender: string | null;
  weight_class: string | null;
  snatch_record: number | null;
  cj_record: number | null;
  total_record: number | null;
  record_type: string | null;
};

type CompleteRecordsRow = {
  age_category: string;
  gender: string;
  weight_class: string;
  snatch_record: number;
  cj_record: number;
  total_record: number;
  record_type: string;
};

function isCompleteRecordsRow(row: RecordsRow): row is CompleteRecordsRow {
  return Boolean(
    row.age_category &&
      row.gender &&
      row.weight_class &&
      row.record_type &&
      row.snatch_record != null &&
      row.cj_record != null &&
      row.total_record != null,
  );
}

function weightClassSort(a: string, b: string): number {
  const parse = (w: string) => {
    if (w.startsWith('+')) return Infinity;
    const num = parseInt(w, 10);
    return isNaN(num) ? Infinity : num;
  };
  const aVal = parse(a);
  const bVal = parse(b);
  if (aVal === bVal) return 0;
  if (aVal === Infinity) return 1;
  if (bVal === Infinity) return -1;
  return aVal - bVal;
}

function filterRecordsData(source: RecordsData, ageGroup?: string, gender?: 'Men' | 'Women'): RecordsData {
  if (!ageGroup && !gender) return source;

  const result: RecordsData = {};
  const groups = ageGroup ? [ageGroup] : Object.keys(source);

  groups.forEach((group) => {
    const row = source[group];
    if (!row) return;
    result[group] = {
      Men: gender === 'Women' ? [] : row.Men,
      Women: gender === 'Men' ? [] : row.Women,
    };
  });

  return result;
}

function mapRowsToRecordsData(rows: CompleteRecordsRow[]): RecordsData {
  const result: RecordsData = {};

  rows.forEach((row) => {
    const ageKey = row.age_category;
    if (!result[ageKey]) {
      result[ageKey] = { Men: [], Women: [] };
    }

    const genderProp = row.gender.toLowerCase() === 'men' ? 'Men' : 'Women';
    result[ageKey][genderProp].push({
      weightClass: row.weight_class,
      snatchRecord: row.snatch_record,
      cjRecord: row.cj_record,
      totalRecord: row.total_record,
    });
  });

  Object.values(result).forEach((group) => {
    group.Men.sort((a, b) => weightClassSort(a.weightClass, b.weightClass));
    group.Women.sort((a, b) => weightClassSort(a.weightClass, b.weightClass));
  });

  return result;
}

function ageGroupSort(a: string, b: string): number {
  const order = ['u11', 'u13', 'u15', 'u17', 'youth', 'collegiate', 'junior', 'senior'];
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  const aIdx = order.indexOf(aLower);
  const bIdx = order.indexOf(bLower);

  if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
  if (aIdx !== -1) return -1;
  if (bIdx !== -1) return 1;

  const mastersRegex = /^masters (?:\+)?(\d{2})(?:-(\d{2})|\+)?$/i;

  const matchA = aLower.match(mastersRegex);
  const matchB = bLower.match(mastersRegex);

  if (matchA && matchB) {
    const numA = parseInt(matchA[1], 10);
    const numB = parseInt(matchB[1], 10);
    return numA - numB;
  }
  if (matchA) return 1;
  if (matchB) return -1;

  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

async function readRecordsCache() {
  return await getOfflineCache<RecordsCache>(OFFLINE_CACHE_KEYS.records);
}

async function readFederationRecordsCache(federation: string) {
  const cached = await readRecordsCache();
  const data = cached?.data?.[federation];
  return data ? { data, lastUpdatedAt: cached.lastSynced } : null;
}

async function fetchRecordsFresh(
  federation: string,
  ageGroup?: string,
  gender?: 'Men' | 'Women',
): Promise<RecordsData> {
  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) {
    throw new Error('Offline');
  }

  const allRows = await getJson<RecordsRow[]>('/data/records');
  const rows = allRows.filter(isCompleteRecordsRow).filter((row) => {
    if (row.record_type !== federation) return false;
    if (ageGroup && row.age_category !== ageGroup) return false;
    if (gender && row.gender.toLowerCase() !== gender.toLowerCase()) return false;
    return true;
  });

  return mapRowsToRecordsData(rows);
}

async function fetchFederationsFresh(): Promise<string[]> {
  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) {
    throw new Error('Offline');
  }

  const rows = await getJson<RecordsRow[]>('/data/records');
  return Array.from(
    new Set(rows.filter(isCompleteRecordsRow).map((row) => row.record_type)),
  ).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
}

async function persistFederationRecords(federation: string, result: RecordsData) {
  const cached = await readRecordsCache();
  const nextCache: RecordsCache = {
    ...(cached?.data || {}),
    [federation]: result,
  };
  const entry = await setOfflineCache(OFFLINE_CACHE_KEYS.records, nextCache);
  return { data: result, lastUpdatedAt: entry.lastSynced };
}

export const federationRecordsResource = createMutableResource<
  RecordsData,
  [string]
>({
  getKey: (federation) => `${OFFLINE_CACHE_KEYS.records}:${federation}`,
  loadCached: (federation) => readFederationRecordsCache(federation),
  fetchFresh: (federation) => fetchRecordsFresh(federation),
  persistFresh: (data, federation) => persistFederationRecords(federation, data),
});

export async function fetchRecords(
  federation: string = 'USAW',
  ageGroup?: string,
  gender?: 'Men' | 'Women'
): Promise<RecordsData> {
  try {
    const result = await fetchRecordsFresh(federation, ageGroup, gender);
    if (!ageGroup && !gender) {
      await persistFederationRecords(federation, result);
    }
    return result;
  } catch (error) {
    const cached = await readFederationRecordsCache(federation);
    if (cached?.data) {
      return filterRecordsData(cached.data, ageGroup, gender);
    }
    throw error;
  }
}

export async function fetchFederations(): Promise<string[]> {
  try {
    return await fetchFederationsFresh();
  } catch (error) {
    const cached = await readRecordsCache();
    const federations = Object.keys(cached?.data || {}).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );
    if (federations.length > 0) {
      return federations;
    }
    console.error('Error fetching federations:', error);
    throw error;
  }
}

export async function fetchAgeGroups(federation: string): Promise<string[]> {
  if (!federation) return [];

  try {
    const data = await fetchRecordsFresh(federation);
    return Object.keys(data).sort(ageGroupSort);
  } catch (error) {
    const cached = await readFederationRecordsCache(federation);
    if (cached?.data) {
      return Object.keys(cached.data).sort(ageGroupSort);
    }
    console.error(`Error fetching age groups for ${federation}:`, error);
    throw error;
  }
}
