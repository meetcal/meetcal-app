import { convex } from '@/lib/convex';
import { api } from '@/convex/_generated/api';
import { RecordsData } from '@/types/records';
import { getOfflineCache, OFFLINE_CACHE_KEYS, setOfflineCache } from './offline-cache';

type RecordsCache = Record<string, RecordsData>;
type RecordsRow = {
  ageCategory: string;
  gender: 'men' | 'women';
  weightClass: string;
  snatchRecord: number | null;
  cjRecord: number | null;
  totalRecord: number | null;
  recordType: string;
};

const recordsMemoryCache = new Map<string, RecordsData>();
const ageGroupsMemoryCache = new Map<string, string[]>();
const inFlightRecords = new Map<string, Promise<RecordsData>>();
let federationsMemoryCache: string[] | null = null;
let inFlightFederations: Promise<string[]> | null = null;
const inFlightAgeGroups = new Map<string, Promise<string[]>>();

// Custom sort: lowest to highest, '+' always last
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

function mapRowsToRecordsData(rows: RecordsRow[]): RecordsData {
  const result: RecordsData = {};

  rows.forEach((row) => {
    const ageKey = row.ageCategory;
    if (!result[ageKey]) {
      result[ageKey] = { Men: [], Women: [] };
    }

    const genderProp = row.gender === 'men' ? 'Men' : 'Women';
    result[ageKey][genderProp].push({
      weightClass: row.weightClass,
      snatchRecord: row.snatchRecord ?? 0,
      cjRecord: row.cjRecord ?? 0,
      totalRecord: row.totalRecord ?? 0,
    });
  });

  Object.values(result).forEach((group) => {
    group.Men.sort((a, b) => weightClassSort(a.weightClass, b.weightClass));
    group.Women.sort((a, b) => weightClassSort(a.weightClass, b.weightClass));
  });

  return result;
}

/**
 * Fetches records data from Convex for a given federation and organizes it into the RecordsData shape.
 * If ageGroup and gender are provided, fetches only that subset.
 */
export async function fetchRecords(
  federation: string = 'USAW',
  ageGroup?: string,
  gender?: 'Men' | 'Women'
): Promise<RecordsData> {
  const requestKey = `${federation}::${ageGroup || '*'}::${gender || '*'}`;

  const cachedFull = recordsMemoryCache.get(federation);
  if (cachedFull) {
    return filterRecordsData(cachedFull, ageGroup, gender);
  }

  if (inFlightRecords.has(requestKey)) {
    return inFlightRecords.get(requestKey)!;
  }

  const cacheKey = OFFLINE_CACHE_KEYS.records;
  const request = (async () => {
    try {
      const rows = await convex.query(api.records.getByFederation, {
        recordType: federation,
        ageCategory: ageGroup,
        gender: gender?.toLowerCase(),
      });

      const result = mapRowsToRecordsData(rows as RecordsRow[]);

      if (!ageGroup && !gender) {
        recordsMemoryCache.set(federation, result);
        ageGroupsMemoryCache.set(federation, Object.keys(result).sort(ageGroupSort));

        const cached = await getOfflineCache<RecordsCache>(cacheKey);
        const nextCache: RecordsCache = {
          ...(cached?.data || {}),
          [federation]: result,
        };
        await setOfflineCache(cacheKey, nextCache);
      }

      return result;
    } catch (error) {
      const cached = await getOfflineCache<RecordsCache>(cacheKey);
      const cachedFederation = cached?.data?.[federation];
      if (cachedFederation) {
        recordsMemoryCache.set(federation, cachedFederation);
        ageGroupsMemoryCache.set(federation, Object.keys(cachedFederation).sort(ageGroupSort));
        return filterRecordsData(cachedFederation, ageGroup, gender);
      }
      throw error;
    } finally {
      inFlightRecords.delete(requestKey);
    }
  })();

  inFlightRecords.set(requestKey, request);
  return request;
}

export async function fetchFederations(): Promise<string[]> {
  if (federationsMemoryCache) {
    return federationsMemoryCache;
  }
  if (inFlightFederations) {
    return inFlightFederations;
  }

  inFlightFederations = (async () => {
    try {
      const federations = await convex.query(api.records.listFederations, {});
      federationsMemoryCache = federations;
      return federations;
    } catch (error) {
      console.error('Error fetching federations:', error);
      throw error;
    } finally {
      inFlightFederations = null;
    }
  })();

  return inFlightFederations;
}

// Helper for sorting age groups
function ageGroupSort(a: string, b: string): number {
  const order = ['u11', 'u13', 'u15', 'u17', 'youth', 'collegiate', 'junior', 'senior'];
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  const aIdx = order.indexOf(aLower);
  const bIdx = order.indexOf(bLower);

  if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
  if (aIdx !== -1) return -1;
  if (bIdx !== -1) return 1;

  // Masters sort (e.g., "Masters 35-39", "Masters 90+", "Masters +90")
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

export async function fetchAgeGroups(federation: string): Promise<string[]> {
  if (!federation) return [];

  if (ageGroupsMemoryCache.has(federation)) {
    return ageGroupsMemoryCache.get(federation)!;
  }

  const cachedRecords = recordsMemoryCache.get(federation);
  if (cachedRecords) {
    const groups = Object.keys(cachedRecords).sort(ageGroupSort);
    ageGroupsMemoryCache.set(federation, groups);
    return groups;
  }

  if (inFlightAgeGroups.has(federation)) {
    return inFlightAgeGroups.get(federation)!;
  }

  const request = (async () => {
    try {
      const rows = await convex.query(api.records.getByFederation, { recordType: federation });

      const ageGroups = Array.from(new Set((rows as RecordsRow[]).map((r) => r.ageCategory)))
        .filter(Boolean)
        .sort(ageGroupSort) as string[];

      ageGroupsMemoryCache.set(federation, ageGroups);
      return ageGroups;
    } catch (error) {
      console.error(`Error fetching age groups for ${federation}:`, error);
      throw error;
    } finally {
      inFlightAgeGroups.delete(federation);
    }
  })();

  inFlightAgeGroups.set(federation, request);
  return request;
}
