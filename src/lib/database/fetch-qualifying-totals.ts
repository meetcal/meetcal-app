import { readQualifyingTotalCategories, readQualifyingTotalsData } from './cached-shapes';
import { createMutableResource } from '@/lib/data/mutable-resource';
import {
  getOfflineCache,
  OFFLINE_CACHE_KEYS,
  readBoundedCacheEntry,
  replaceOfflineCache,
  setOfflineCache,
  writeBoundedCacheEntry,
} from './offline-cache';
import {
  fetchApiQualifyingTotalCategories,
  fetchApiQualifyingTotalsTagged,
  type ApiQualifyingTotalCategory,
  type ApiQualifyingTotalRow,
} from '@/lib/api/reference-api';
import type { ResourceCacheEntry } from '@/lib/data/mutable-resource';
import { mapTagged, requireNetwork, resourceEntry, untagged } from './tagged-read';


export type QualifyingTotalsData = {
  [eventName: string]: {
    [ageCategory: string]: {
      Men: { [weightClass: string]: number };
      Women: { [weightClass: string]: number };
    };
  };
};

async function readQualifyingTotalsCache() {
  const cacheKey = OFFLINE_CACHE_KEYS.qualifyingTotals;
  return resourceEntry(await getOfflineCache(cacheKey, readQualifyingTotalsData));
}

async function fetchQualifyingTotalsTagged(knownTag: string | null) {
  await requireNetwork();
  return mapTagged(await fetchApiQualifyingTotalsTagged(knownTag), mapQualifyingTotals);
}

function fetchQualifyingTotalsFresh(): Promise<QualifyingTotalsData> {
  return untagged(fetchQualifyingTotalsTagged(null), '/data/qualifying-totals');
}

function mapQualifyingTotals(rows: readonly Readonly<ApiQualifyingTotalRow>[]): QualifyingTotalsData {
  const result: QualifyingTotalsData = {};
  rows.forEach((row) => {
    const e = row.event_name;
    const a = row.age_category;
    const g = row.gender;
    const w = row.weight_class;
    if (typeof e !== 'string' || typeof a !== 'string' || typeof w !== 'string') return;
    // Only 'Men' and 'Women' buckets exist. Indexing with anything else
    // ("M", null, "Mixed") would blow up the whole payload on one bad row —
    // the same guard `fetch-wso-records` already applies.
    if (g !== 'Men' && g !== 'Women') return;
    if (typeof row.qualifying_total !== 'number') return;
    if (!result[e]) result[e] = {};
    if (!result[e][a]) result[e][a] = { Men: {}, Women: {} };
    result[e][a][g][w] = row.qualifying_total;
  });

  return result;
}

/**
 * No qualifying total in any event (an event is only added with a row in it,
 * so no events means no rows). Neither the explicit download nor the browse
 * path (which writes to the download's key) stores such an answer: it would
 * replace a real download with nothing. The screen still shows the empty
 * answer; the stored copy stays.
 */
export const EMPTY_QUALIFYING_TOTALS: QualifyingTotalsData = {};

export function isQualifyingTotalsDataEmpty(data: QualifyingTotalsData): boolean {
  return Object.keys(data).length === 0;
}

async function persistQualifyingTotals(data: QualifyingTotalsData, tag: string | null) {
  if (isQualifyingTotalsDataEmpty(data)) return null;
  return resourceEntry(await setOfflineCache(OFFLINE_CACHE_KEYS.qualifyingTotals, data, tag));
}

/**
 * Explicit offline download / refresh: fresh from the API and stored, or a
 * rejection that leaves the stored copy untouched. Never the cached fallback.
 */
export async function downloadQualifyingTotalsForOffline(): Promise<void> {
  const data = await fetchQualifyingTotalsFresh();
  if (isQualifyingTotalsDataEmpty(data)) {
    throw new Error('Qualifying totals download returned no rows');
  }
  await replaceOfflineCache(OFFLINE_CACHE_KEYS.qualifyingTotals, data);
}

export const qualifyingTotalsResource = createMutableResource<
  QualifyingTotalsData,
  []
>({
  getKey: () => OFFLINE_CACHE_KEYS.qualifyingTotals,
  loadCached: () => readQualifyingTotalsCache(),
  fetchFresh: () => fetchQualifyingTotalsFresh(),
  persistFresh: (data) => persistQualifyingTotals(data, null),
  tagged: {
    fetch: (knownTag) => fetchQualifyingTotalsTagged(knownTag),
    persist: (data, tag) => persistQualifyingTotals(data, tag),
  },
});

export const MAX_BROWSED_QUALIFYING_EVENTS = 8;

export type QualifyingTotalCategories = {
  events: string[];
  ageGroupsByEvent: Record<string, string[]>;
};

function newestEntry<T>(...entries: (ResourceCacheEntry<T> | null)[]): ResourceCacheEntry<T> | null {
  let newest: ResourceCacheEntry<T> | null = null;
  for (const entry of entries) {
    if (entry && (newest === null || (entry.lastUpdatedAt ?? 0) > (newest.lastUpdatedAt ?? 0))) newest = entry;
  }
  return newest;
}

async function readEventTotalsCache(event: string): Promise<ResourceCacheEntry<QualifyingTotalsData> | null> {
  const [whole, browsed] = await Promise.all([
    readQualifyingTotalsCache(),
    readBoundedCacheEntry(OFFLINE_CACHE_KEYS.qualifyingTotalsBrowse, event, readQualifyingTotalsData),
  ]);
  const fromWhole =
    whole && whole.data[event] ? { data: { [event]: whole.data[event] }, lastUpdatedAt: whole.lastUpdatedAt } : null;
  return newestEntry(fromWhole, browsed);
}

async function fetchEventTotalsTagged(knownTag: string | null, event: string) {
  await requireNetwork();
  return mapTagged(await fetchApiQualifyingTotalsTagged(knownTag, { event }), mapQualifyingTotals);
}

async function persistEventTotals(event: string, data: QualifyingTotalsData, tag: string | null) {
  if (isQualifyingTotalsDataEmpty(data)) return null;
  return writeBoundedCacheEntry(
    OFFLINE_CACHE_KEYS.qualifyingTotalsBrowse,
    event,
    data,
    MAX_BROWSED_QUALIFYING_EVENTS,
    tag,
  );
}

export const qualifyingTotalsForEventResource = createMutableResource<QualifyingTotalsData, [string]>({
  getKey: (event) => `${OFFLINE_CACHE_KEYS.qualifyingTotalsBrowse}:${event}`,
  loadCached: (event) => readEventTotalsCache(event),
  fetchFresh: (event) => untagged(fetchEventTotalsTagged(null, event), '/data/qualifying-totals'),
  persistFresh: (data, event) => persistEventTotals(event, data, null),
  tagged: {
    fetch: (knownTag, event) => fetchEventTotalsTagged(knownTag, event),
    persist: (data, tag, event) => persistEventTotals(event, data, tag),
  },
});

export function categoriesFromRows(rows: readonly Readonly<ApiQualifyingTotalCategory>[]): QualifyingTotalCategories {
  const ageGroupsByEvent: Record<string, string[]> = {};
  for (const { event_name, age_category } of rows) {
    const ageGroups = (ageGroupsByEvent[event_name] ??= []);
    if (!ageGroups.includes(age_category)) ageGroups.push(age_category);
  }
  return { events: Object.keys(ageGroupsByEvent), ageGroupsByEvent };
}

export function categoriesFromTotals(data: QualifyingTotalsData): QualifyingTotalCategories {
  const ageGroupsByEvent: Record<string, string[]> = {};
  for (const [event, ageGroups] of Object.entries(data)) ageGroupsByEvent[event] = Object.keys(ageGroups);
  return { events: Object.keys(ageGroupsByEvent), ageGroupsByEvent };
}

async function readCategoriesCache(): Promise<ResourceCacheEntry<QualifyingTotalCategories> | null> {
  const [whole, stored] = await Promise.all([
    readQualifyingTotalsCache(),
    getOfflineCache(OFFLINE_CACHE_KEYS.qualifyingTotalCategories, readQualifyingTotalCategories),
  ]);
  const fromWhole =
    whole && !isQualifyingTotalsDataEmpty(whole.data)
      ? { data: categoriesFromTotals(whole.data), lastUpdatedAt: whole.lastUpdatedAt }
      : null;
  const fromStored = stored ? { data: stored.data, lastUpdatedAt: stored.lastSynced } : null;
  return newestEntry(fromWhole, fromStored);
}

async function fetchCategoriesFresh(): Promise<QualifyingTotalCategories> {
  await requireNetwork();
  return categoriesFromRows(await fetchApiQualifyingTotalCategories());
}

async function persistCategories(data: QualifyingTotalCategories) {
  if (data.events.length === 0) return null;
  return resourceEntry(await setOfflineCache(OFFLINE_CACHE_KEYS.qualifyingTotalCategories, data));
}

export const qualifyingTotalCategoriesResource = createMutableResource<QualifyingTotalCategories, []>({
  getKey: () => OFFLINE_CACHE_KEYS.qualifyingTotalCategories,
  loadCached: () => readCategoriesCache(),
  fetchFresh: () => fetchCategoriesFresh(),
  persistFresh: (data) => persistCategories(data),
});
