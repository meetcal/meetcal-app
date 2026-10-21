import { createMutableResource } from '@/lib/data/mutable-resource';
import { RecordsData } from '@/types/records';
import { isNetworkAvailable } from '@/lib/networkUtils';
import {
  getOfflineCache,
  OFFLINE_CACHE_KEYS,
  readBoundedCacheEntry,
  readBoundedCacheKeys,
  replaceOfflineCache,
  writeBoundedCacheEntry,
} from './offline-cache';
import { fetchApiRecords, type ApiRecordRow } from '@/lib/api/meetcal-api';
import { weightClassSort } from './weight-class-sort';

type RecordsCache = Record<string, RecordsData>;

/**
 * Federations kept from browsing Records. There are only a handful (USAW,
 * IWF, Pan Am, ...), so this keeps every one a user opens.
 */
export const MAX_BROWSED_RECORD_FEDERATIONS = 8;

/** The federation Records opens on, listed first. */
export const DEFAULT_RECORD_FEDERATION = 'USAW';

type CompleteRecordsRow = Readonly<ApiRecordRow> & {
  age_category: string;
  gender: string;
  weight_class: string;
  record_type: string;
};

/**
 * A row needs only its keys. A lift with no record set stays `null` and shows
 * as "—"; requiring all three dropped a class with one unset lift, its claimed
 * lifts and holders with it.
 */
function isCompleteRecordsRow(row: Readonly<ApiRecordRow>): row is CompleteRecordsRow {
  return Boolean(row.age_category && row.gender && row.weight_class && row.record_type);
}

function mapRowsToRecordsData(rows: readonly CompleteRecordsRow[]): RecordsData {
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

/**
 * One federation's records: from the explicit download or from browsing,
 * whichever was written last, each with its own write time.
 */
async function readFederationRecordsCache(federation: string) {
  const [downloaded, browsed] = await Promise.all([
    readRecordsCache(),
    readBoundedCacheEntry<RecordsData>(OFFLINE_CACHE_KEYS.recordsBrowse, federation),
  ]);
  const data = downloaded?.data?.[federation];
  const fromDownload = data ? { data, lastUpdatedAt: downloaded.lastSynced } : null;
  if (!browsed) return fromDownload;
  if (!fromDownload) return browsed;
  return browsed.lastUpdatedAt > fromDownload.lastUpdatedAt ? browsed : fromDownload;
}

async function fetchRecordsFresh(federation: string): Promise<RecordsData> {
  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) {
    throw new Error('Offline');
  }

  const allRows = await fetchApiRecords();
  const rows = allRows
    .filter(isCompleteRecordsRow)
    .filter((row) => row.record_type === federation);

  return mapRowsToRecordsData(rows);
}

/**
 * Browsing keeps what it fetched in its own cache, apart from the explicit
 * download (`OFFLINE_CACHE_KEYS.records`). It used to merge one federation
 * into the download's entry, which also reset that entry's `lastSynced`: one
 * look at USAW made Offline Data show "National & World Records" as
 * downloaded and "Last synced just now", with no IWF records on the device,
 * and made a month-old download of the other federations read as fresh.
 */
function persistFederationRecords(federation: string, result: RecordsData) {
  return writeBoundedCacheEntry(
    OFFLINE_CACHE_KEYS.recordsBrowse,
    federation,
    result,
    MAX_BROWSED_RECORD_FEDERATIONS,
  );
}

/**
 * Explicit offline download / refresh of every federation's records.
 *
 * One `/data/records` request, grouped by federation, and one write of the
 * whole cache once every federation has mapped. The old download listed
 * federations and then re-requested the same table once per federation, each
 * through a browse fetcher that fell back to the cached copy on failure — so
 * a refresh whose requests failed still "succeeded". Rejects (leaving the
 * stored copy untouched) when offline, on an API error, or when the table
 * has no usable rows.
 */
export async function downloadRecordsForOffline(): Promise<void> {
  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) {
    throw new Error('Offline');
  }

  const rowsByFederation = new Map<string, CompleteRecordsRow[]>();
  for (const row of await fetchApiRecords()) {
    if (!isCompleteRecordsRow(row)) continue;
    const rows = rowsByFederation.get(row.record_type);
    if (rows) {
      rows.push(row);
    } else {
      rowsByFederation.set(row.record_type, [row]);
    }
  }
  if (rowsByFederation.size === 0) {
    throw new Error('Records download returned no federations');
  }

  const nextCache: RecordsCache = {};
  for (const [federation, rows] of rowsByFederation) {
    nextCache[federation] = mapRowsToRecordsData(rows);
  }
  await replaceOfflineCache(OFFLINE_CACHE_KEYS.records, nextCache);
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

/** `DEFAULT_RECORD_FEDERATION` first, then the rest alphabetically. */
function sortRecordFederations(federations: Iterable<string>): string[] {
  return [...new Set(federations)].sort((a, b) => {
    if (a === b) return 0;
    if (a === DEFAULT_RECORD_FEDERATION) return -1;
    if (b === DEFAULT_RECORD_FEDERATION) return 1;
    return a.localeCompare(b);
  });
}

/**
 * The federations the records table holds records for. Offline (or on a
 * failed request) it lists the federations stored on the device, from the
 * download and from browsing; it rejects when there are none.
 */
export async function fetchRecordFederations(): Promise<string[]> {
  try {
    if (!(await isNetworkAvailable())) throw new Error('Offline');
    const federations = new Set<string>();
    for (const row of await fetchApiRecords()) {
      if (isCompleteRecordsRow(row)) federations.add(row.record_type);
    }
    if (federations.size === 0) throw new Error('Records table returned no federations');
    return sortRecordFederations(federations);
  } catch (error) {
    const [downloaded, browsed] = await Promise.all([
      readRecordsCache(),
      readBoundedCacheKeys(OFFLINE_CACHE_KEYS.recordsBrowse),
    ]);
    const cached = sortRecordFederations([...Object.keys(downloaded?.data ?? {}), ...browsed]);
    if (cached.length > 0) return cached;
    throw error;
  }
}
