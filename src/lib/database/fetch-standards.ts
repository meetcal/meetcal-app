import { readStandardsData } from './cached-shapes';
import { createMutableResource } from '@/lib/data/mutable-resource';
import { StandardsData } from '@/types/standards';
import {
  getOfflineCache,
  OFFLINE_CACHE_KEYS,
  replaceOfflineCache,
  setOfflineCache,
} from './offline-cache';
import { fetchApiStandardsTagged, type ApiStandardRow } from '@/lib/api/reference-api';
import { mapTagged, requireNetwork, resourceEntry, untagged } from './tagged-read';
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

function mapRows(rows: readonly CompleteStandardsRow[]): StandardsData {
  const result: StandardsData = {
    u15: { men: [], women: [] },
    youth: { men: [], women: [] },
    junior: { men: [], women: [] },
    senior: { men: [], women: [] },
  };

  rows.forEach((row) => {
    const ageKey = row.age_category.toLowerCase() as keyof StandardsData;
    const genderKey = row.gender.toLowerCase();
    if (genderKey !== 'men' && genderKey !== 'women') return;
    if (!result[ageKey] || !result[ageKey][genderKey]) return;
    result[ageKey][genderKey].push({
      weightClass: row.weight_class,
      a: row.standard_a,
      b: row.standard_b,
    });
  });

  Object.values(result).forEach((group) => {
    group.men?.sort((a, b) => weightClassSort(a.weightClass, b.weightClass));
    group.women?.sort((a, b) => weightClassSort(a.weightClass, b.weightClass));
  });

  return result;
}

async function readStandardsCache() {
  const cacheKey = OFFLINE_CACHE_KEYS.standards;
  return resourceEntry(await getOfflineCache(cacheKey, readStandardsData));
}

async function fetchStandardsTagged(knownTag: string | null) {
  await requireNetwork();
  return mapTagged(await fetchApiStandardsTagged(knownTag), (rows) => mapRows(rows.filter(isCompleteStandardsRow)));
}

function fetchStandardsFresh(): Promise<StandardsData> {
  return untagged(fetchStandardsTagged(null), '/data/standards');
}

/**
 * No standard in any age group or gender. Neither the explicit download nor
 * the browse path (which writes to the download's key) stores such an
 * answer: it would replace a real download with nothing. The screen still
 * shows the empty answer; the stored copy stays.
 */
export function isStandardsDataEmpty(data: StandardsData): boolean {
  return Object.values(data).every((group) => (group.men?.length ?? 0) + (group.women?.length ?? 0) === 0);
}

async function persistStandards(data: StandardsData, tag: string | null) {
  if (isStandardsDataEmpty(data)) return null;
  return resourceEntry(await setOfflineCache(OFFLINE_CACHE_KEYS.standards, data, tag));
}

/**
 * Explicit offline download / refresh: fresh from the API and stored, or a
 * rejection. Never the cached copy (the browse path's fallback), which would
 * let a failed refresh report success. On failure the stored copy is untouched.
 */
export async function downloadStandardsForOffline(): Promise<void> {
  const data = await fetchStandardsFresh();
  if (isStandardsDataEmpty(data)) {
    throw new Error('Standards download returned no rows');
  }
  await replaceOfflineCache(OFFLINE_CACHE_KEYS.standards, data);
}

export const standardsResource = createMutableResource<StandardsData, []>({
  getKey: () => OFFLINE_CACHE_KEYS.standards,
  loadCached: () => readStandardsCache(),
  fetchFresh: () => fetchStandardsFresh(),
  persistFresh: (data) => persistStandards(data, null),
  tagged: {
    fetch: (knownTag) => fetchStandardsTagged(knownTag),
    persist: (data, tag) => persistStandards(data, tag),
  },
});
