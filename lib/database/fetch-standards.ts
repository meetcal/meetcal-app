import { createMutableResource } from '@/lib/data/mutable-resource';
import { StandardsData } from '@/types/standards';
import { isNetworkAvailable } from '@/lib/networkUtils';
import {
  getOfflineCache,
  OFFLINE_CACHE_KEYS,
  replaceOfflineCache,
  setOfflineCache,
} from './offline-cache';
import { fetchApiStandards, type ApiStandardRow } from '@/lib/api/meetcal-api';
import { weightClassSort } from './weight-class-sort';

type CompleteStandardsRow = Readonly<ApiStandardRow> & {
  age_category: string;
  gender: string;
  weight_class: string;
};

/**
 * `age_category`/`gender`/`weight_class` are nullable in the source table.
 * `.toLowerCase()` on a null row threw and took the *whole* standards payload
 * down, offline cache included — the same one-bad-row failure the qualifying
 * totals fetcher already guards against.
 */
function isCompleteStandardsRow(row: Readonly<ApiStandardRow>): row is CompleteStandardsRow {
  return Boolean(row.age_category && row.gender && row.weight_class);
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

function mapRows(rows: readonly CompleteStandardsRow[]): StandardsData {
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

  const allRows = await fetchApiStandards();
  const rows = allRows.filter(isCompleteStandardsRow).filter((row) => {
    if (ageGroup && row.age_category.toLowerCase() !== ageGroup) return false;
    if (gender && row.gender.toLowerCase() !== gender) return false;
    return true;
  });

  return mapRows(rows);
}

async function persistStandards(data: StandardsData) {
  const entry = await setOfflineCache(OFFLINE_CACHE_KEYS.standards, data);
  return { data: entry.data, lastUpdatedAt: entry.lastSynced };
}

/**
 * Explicit offline download / refresh: fresh from the API and stored, or a
 * rejection. Never the cached copy — `fetchStandards` falls back to it, which
 * let a failed refresh report success. On failure the stored copy is untouched.
 */
export async function downloadStandardsForOffline(): Promise<void> {
  const data = await fetchStandardsFresh();
  await replaceOfflineCache(OFFLINE_CACHE_KEYS.standards, data);
}

export const standardsResource = createMutableResource<StandardsData, []>({
  getKey: () => OFFLINE_CACHE_KEYS.standards,
  loadCached: () => readStandardsCache(),
  fetchFresh: () => fetchStandardsFresh(),
  persistFresh: (data) => persistStandards(data),
});
