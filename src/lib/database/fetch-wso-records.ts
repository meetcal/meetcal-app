import { createMutableResource } from '@/lib/data/mutable-resource';
import { RecordsData, AgeGroupRecords, WeightClassRecord } from '@/types/records';
import { isNetworkAvailable } from '@/lib/networkUtils';
import {
  getOfflineCache,
  OFFLINE_CACHE_KEYS,
  readBoundedCacheEntry,
  replaceOfflineCache,
  writeBoundedCacheEntry,
} from './offline-cache';
import {
  fetchApiWsoAgeGroups,
  fetchApiWsoList,
  fetchApiWsoRecords,
  type ApiWsoRecordRow,
} from '@/lib/api/meetcal-api';
import { filterRecordsData } from './records-filter';
import { weightClassSort } from './weight-class-sort';

type WSORecordsCache = Record<string, RecordsData>;

/**
 * Most WSOs an offline download will fetch, one request each. USAW has a few
 * dozen; a list past this is a malformed response, not a bigger federation,
 * and is rejected rather than looped over.
 */
export const MAX_OFFLINE_WSO_COUNT = 100;

/**
 * WSO + age group + gender views kept for offline browsing. A view is one
 * age group's classes (a few KB); 30 covers both genders of every age group
 * for a WSO or two. The full per-WSO copy an offline download stores
 * (`wsoRecords`) is separate and not capped.
 */
export const MAX_CACHED_WSO_RECORD_VIEWS = 30;

async function readWSOCache() {
  return await getOfflineCache<WSORecordsCache>(OFFLINE_CACHE_KEYS.wsoRecords);
}

function getFilteredCacheKey(wso: string, ageGroup: string, gender: 'Men' | 'Women') {
  return [wso, ageGroup, gender].join(':');
}

async function readWSORecordsCache(wso: string) {
  const cached = await readWSOCache();
  const data = cached?.data?.[wso];
  return data ? { data, lastUpdatedAt: cached.lastSynced } : null;
}

/**
 * One WSO + age group + gender view: the browsed copy or the view derived
 * from the explicit download, whichever was written last (as
 * `readFederationRecordsCache` does for Records). The browsed copy used to
 * win whenever it existed, so a view browsed in January hid a Refresh All
 * from March.
 */
async function readFilteredWSORecordsCache(
  wso: string,
  ageGroup: string,
  gender: 'Men' | 'Women',
) {
  const [browsed, downloaded] = await Promise.all([
    readBoundedCacheEntry<RecordsData>(
      OFFLINE_CACHE_KEYS.wsoRecordsFiltered,
      getFilteredCacheKey(wso, ageGroup, gender),
    ),
    readWSORecordsCache(wso),
  ]);
  const fromDownload = downloaded
    ? {
        data: filterRecordsData(downloaded.data, ageGroup, gender),
        lastUpdatedAt: downloaded.lastUpdatedAt,
      }
    : null;
  if (!browsed) return fromDownload;
  if (!fromDownload) return browsed;
  return browsed.lastUpdatedAt > fromDownload.lastUpdatedAt ? browsed : fromDownload;
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

  const rows = await fetchApiWsoRecords(wso, ageGroup, gender);

  // `age_category`/`weight_class` are nullable in the source table. A null
  // age category used to create a literal "null" bucket in the records map,
  // which then rendered as an age group the user could select.
  const completeRows = rows.filter(
    (row): row is Readonly<ApiWsoRecordRow> & { age_category: string; weight_class: string } =>
      Boolean(row.age_category && row.weight_class),
  );
  const ageGroups = Array.from(new Set(completeRows.map((row) => row.age_category)));

  const result: RecordsData = {};
  ageGroups.forEach((g) => {
    result[g] = { Men: [], Women: [] };
  });

  completeRows.forEach((row) => {
    const ageKey = row.age_category;
    const genderKey = row.gender;
    if (!result[ageKey]) return;
    if (genderKey !== 'Men' && genderKey !== 'Women') return;

    result[ageKey][genderKey].push({
      weightClass: row.weight_class,
      snatchRecord: row.snatch_record,
      cjRecord: row.cj_record,
      totalRecord: row.total_record,
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

/**
 * Browsing keeps each view in its own bounded cache, never in the explicit
 * download (`OFFLINE_CACHE_KEYS.wsoRecords`), whose `lastSynced` would
 * otherwise read as a fresh download of every WSO.
 */
function persistFilteredWSORecords(
  wso: string,
  ageGroup: string,
  gender: 'Men' | 'Women',
  result: RecordsData,
) {
  return writeBoundedCacheEntry(
    OFFLINE_CACHE_KEYS.wsoRecordsFiltered,
    getFilteredCacheKey(wso, ageGroup, gender),
    result,
    MAX_CACHED_WSO_RECORD_VIEWS,
  );
}

/**
 * Explicit offline download / refresh of every WSO's records.
 *
 * Sequential, one request per WSO, and a single write of the whole cache only
 * after every WSO arrived. The old loop went through a browse fetcher that fell
 * back to the cached copy on failure, so it could "succeed" having refreshed
 * nothing.
 * Rejects, leaving the stored copy untouched, when offline, on any API error,
 * on an empty list, or on a list longer than `MAX_OFFLINE_WSO_COUNT`.
 */
export async function downloadWSORecordsForOffline(): Promise<void> {
  const wsos = await fetchWSOListFresh();
  if (wsos.length === 0) {
    throw new Error('WSO records download returned no WSOs');
  }
  if (wsos.length > MAX_OFFLINE_WSO_COUNT) {
    throw new Error(
      `WSO list has ${wsos.length} entries, more than ${MAX_OFFLINE_WSO_COUNT}`,
    );
  }

  const nextCache: WSORecordsCache = {};
  for (const wso of wsos) {
    nextCache[wso] = await fetchWSORecordsFresh(wso);
  }
  await replaceOfflineCache(OFFLINE_CACHE_KEYS.wsoRecords, nextCache);
}

export const wsoRecordsResource = createMutableResource<RecordsData, [string, string, 'Men' | 'Women']>({
  getKey: (wso, ageGroup, gender) => `${OFFLINE_CACHE_KEYS.wsoRecords}:${wso}:${ageGroup}:${gender}`,
  loadCached: (wso, ageGroup, gender) => readFilteredWSORecordsCache(wso, ageGroup, gender),
  fetchFresh: (wso, ageGroup, gender) => fetchWSORecordsFresh(wso, ageGroup, gender),
  persistFresh: (data, wso, ageGroup, gender) =>
    persistFilteredWSORecords(wso, ageGroup, gender, data),
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
