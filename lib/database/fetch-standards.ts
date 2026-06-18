import { createMutableResource } from '@/lib/data/mutable-resource';
import { StandardsData } from '@/types/standards';
import { isNetworkAvailable } from '@/lib/networkUtils';
import { getOfflineCache, OFFLINE_CACHE_KEYS, setOfflineCache } from './offline-cache';
import { getJson } from '@/lib/api/meetcal-api';

type StandardsRow = {
  age_category: string;
  gender: string;
  weight_class: string;
  standard_a: number | null;
  standard_b: number | null;
};

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

function filterStandards(data: StandardsData, ageGroup?: string, gender?: 'men' | 'women'): StandardsData {
  if (!ageGroup && !gender) return data;

  const result: StandardsData = {
    u15: { men: [], women: [] },
    youth: { men: [], women: [] },
    junior: { men: [], women: [] },
    senior: { men: [], women: [] },
  };

  const ageGroups = ageGroup ? [ageGroup as keyof StandardsData] : (Object.keys(result) as (keyof StandardsData)[]);
  ageGroups.forEach((group) => {
    const source = data[group];
    if (!source) return;
    result[group] = {
      men: gender === 'women' ? [] : source.men,
      women: gender === 'men' ? [] : source.women,
    };
  });

  return result;
}

function mapRows(rows: StandardsRow[]): StandardsData {
  const result: StandardsData = {
    u15: { men: [], women: [] },
    youth: { men: [], women: [] },
    junior: { men: [], women: [] },
    senior: { men: [], women: [] },
  };

  rows.forEach((row) => {
    const ageKey = row.age_category.toLowerCase() as keyof StandardsData;
    const genderKey = row.gender.toLowerCase() as 'men' | 'women';
    if (!result[ageKey] || !result[ageKey][genderKey]) return;
    result[ageKey][genderKey].push({
      weightClass: row.weight_class,
      a: row.standard_a ?? 0,
      b: row.standard_b ?? 0,
    });
  });

  Object.values(result).forEach((group) => {
    group.men.sort((a, b) => weightClassSort(a.weightClass, b.weightClass));
    group.women.sort((a, b) => weightClassSort(a.weightClass, b.weightClass));
  });

  return result;
}

/**
 * Fetches standards data from the MeetCal API and organizes it into the StandardsData shape.
 * If ageGroup and gender are provided, fetches only that subset.
 */
export async function fetchStandards(
  ageGroup?: string,
  gender?: 'men' | 'women'
): Promise<StandardsData> {
  try {
    const result = await fetchStandardsFresh(ageGroup, gender);
    if (!ageGroup && !gender) {
      await persistStandards(result);
    }
    return result;
  } catch (error) {
    const cached = await readStandardsCache();
    if (cached?.data) {
      return filterStandards(cached.data, ageGroup, gender);
    }
    throw error;
  }
}

async function readStandardsCache() {
  const cacheKey = OFFLINE_CACHE_KEYS.standards;
  const cached = await getOfflineCache<StandardsData>(cacheKey);
  return cached ? { data: cached.data, lastUpdatedAt: cached.lastSynced } : null;
}

async function fetchStandardsFresh(
  ageGroup?: string,
  gender?: 'men' | 'women'
): Promise<StandardsData> {
  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) {
    throw new Error('Offline');
  }

  const allRows = await getJson<StandardsRow[]>('/data/standards');
  const rows = allRows.filter((row) => {
    if (ageGroup && row.age_category.toLowerCase() !== ageGroup) return false;
    if (gender && row.gender.toLowerCase() !== gender) return false;
    return true;
  });

  return mapRows(rows as StandardsRow[]);
}

async function persistStandards(data: StandardsData) {
  const entry = await setOfflineCache(OFFLINE_CACHE_KEYS.standards, data);
  return { data: entry.data, lastUpdatedAt: entry.lastSynced };
}

export const standardsResource = createMutableResource<StandardsData, []>({
  getKey: () => OFFLINE_CACHE_KEYS.standards,
  loadCached: () => readStandardsCache(),
  fetchFresh: () => fetchStandardsFresh(),
  persistFresh: (data) => persistStandards(data),
});
