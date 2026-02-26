import { convex } from '@/lib/convex';
import { api } from '@/convex/_generated/api';
import { StandardsData } from '@/types/standards';
import { isNetworkAvailable } from '@/lib/networkUtils';
import { getOfflineCache, OFFLINE_CACHE_KEYS, setOfflineCache } from './offline-cache';

type StandardsRow = {
  ageCategory: keyof StandardsData;
  gender: 'men' | 'women';
  weightClass: string;
  standardA: number | null;
  standardB: number | null;
};

const standardsMemoryCache: { data: StandardsData | null } = { data: null };
const inFlightStandards = new Map<string, Promise<StandardsData>>();

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
    const ageKey = row.ageCategory;
    const genderKey = row.gender;
    if (!result[ageKey] || !result[ageKey][genderKey]) return;
    result[ageKey][genderKey].push({
      weightClass: row.weightClass,
      a: row.standardA ?? 0,
      b: row.standardB ?? 0,
    });
  });

  Object.values(result).forEach((group) => {
    group.men.sort((a, b) => weightClassSort(a.weightClass, b.weightClass));
    group.women.sort((a, b) => weightClassSort(a.weightClass, b.weightClass));
  });

  return result;
}

/**
 * Fetches standards data from Convex and organizes it into the StandardsData shape.
 * If ageGroup and gender are provided, fetches only that subset.
 */
export async function fetchStandards(
  ageGroup?: string,
  gender?: 'men' | 'women'
): Promise<StandardsData> {
  const requestKey = `${ageGroup || '*'}::${gender || '*'}`;
  if (standardsMemoryCache.data) {
    return filterStandards(standardsMemoryCache.data, ageGroup, gender);
  }
  if (inFlightStandards.has(requestKey)) {
    return inFlightStandards.get(requestKey)!;
  }

  const cacheKey = OFFLINE_CACHE_KEYS.standards;
  const request = (async () => {
    try {
      const hasNetwork = await isNetworkAvailable();
      if (!hasNetwork) {
        throw new Error('Offline');
      }

      const rows = await convex.query(api.standards.getFiltered, {
        ageCategory: ageGroup,
        gender,
      });

      const result = mapRows(rows as StandardsRow[]);
      if (!ageGroup && !gender) {
        standardsMemoryCache.data = result;
        await setOfflineCache(cacheKey, result);
      }
      return result;
    } catch (error) {
      const cached = await getOfflineCache<StandardsData>(cacheKey);
      if (cached?.data) {
        standardsMemoryCache.data = cached.data;
        return filterStandards(cached.data, ageGroup, gender);
      }
      throw error;
    } finally {
      inFlightStandards.delete(requestKey);
    }
  })();

  inFlightStandards.set(requestKey, request);
  return request;
}
