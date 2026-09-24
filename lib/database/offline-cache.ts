import AsyncStorage from '@react-native-async-storage/async-storage';

export type OfflineCacheEntry<T> = {
  data: T;
  lastSynced: number;
};

export const OFFLINE_CACHE_KEYS = {
  standards: '@offline_cache/standards',
  qualifyingTotals: '@offline_cache/qualifying_totals',
  intlRankings: '@offline_cache/intl_rankings',
  records: '@offline_cache/records',
  wsoRecords: '@offline_cache/wso_records',
  wsoRecordsFiltered: '@offline_cache/wso_records_filtered',
  adaptiveRecords: '@offline_cache/adaptive_records',
  nationalRankings: '@offline_cache/national_rankings',
  clubs: '@offline_cache/clubs',
  clubAthletes: '@offline_cache/club_athletes',
  clubMeetStats: '@offline_cache/club_meet_stats',
} as const;

function isOfflineCacheEntry(value: unknown): value is OfflineCacheEntry<unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!('data' in value)) return false;
  const lastSynced = (value as { lastSynced?: unknown }).lastSynced;
  return typeof lastSynced === 'number' && Number.isFinite(lastSynced);
}

export async function getOfflineCache<T>(key: string): Promise<OfflineCacheEntry<T> | null> {
  try {
    const stored = await AsyncStorage.getItem(key);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (!isOfflineCacheEntry(parsed)) return null;
    return parsed as OfflineCacheEntry<T>;
  } catch (error) {
    console.error('Error reading offline cache:', error);
    return null;
  }
}

export async function setOfflineCache<T>(key: string, data: T): Promise<OfflineCacheEntry<T>> {
  const entry: OfflineCacheEntry<T> = {
    data,
    lastSynced: Date.now()
  };
  try {
    await AsyncStorage.setItem(key, JSON.stringify(entry));
  } catch (error) {
    console.error('Error writing offline cache:', error);
  }
  return entry;
}

/**
 * `setOfflineCache` for an explicit download or refresh: a failed write
 * rejects instead of being logged and reported as stored.
 *
 * The browse path deliberately swallows a failed write (fresh data is still
 * shown). A download is different: "Downloaded" / "Refresh Complete" is a
 * promise the data is on the device, and the write is the only thing that
 * keeps it. A rejected write leaves the previous entry in place.
 */
export async function replaceOfflineCache<T>(key: string, data: T): Promise<OfflineCacheEntry<T>> {
  const entry: OfflineCacheEntry<T> = {
    data,
    lastSynced: Date.now(),
  };
  await AsyncStorage.setItem(key, JSON.stringify(entry));
  return entry;
}

export async function clearOfflineCache(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch (error) {
    console.error('Error clearing offline cache:', error);
  }
}

/** One entry of a bounded browse cache, with its own write time. */
type BoundedCacheRecord = { key: string; data: unknown; lastSynced: number };

function isBoundedCacheRecord(value: unknown): value is BoundedCacheRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as { key?: unknown; lastSynced?: unknown };
  return (
    typeof record.key === 'string' &&
    'data' in value &&
    typeof record.lastSynced === 'number' &&
    Number.isFinite(record.lastSynced)
  );
}

/**
 * The records of a bounded cache, oldest write first.
 *
 * Also reads the unbounded shape these keys used to hold (a plain
 * `Record<entryKey, data>` under one blob-wide `lastSynced`), so an update
 * does not throw away what a user browsed before it.
 */
function readBoundedRecords(entry: OfflineCacheEntry<unknown> | null): BoundedCacheRecord[] {
  if (!entry) return [];
  const { data, lastSynced } = entry;
  if (Array.isArray(data)) return data.filter(isBoundedCacheRecord);
  if (data && typeof data === 'object') {
    return Object.entries(data).map(([key, value]) => ({ key, data: value, lastSynced }));
  }
  return [];
}

/**
 * One entry of a browse cache written by `writeBoundedCacheEntry`, with the
 * time that entry was written (not the last write of any entry).
 */
export async function readBoundedCacheEntry<T>(
  cacheKey: string,
  entryKey: string,
): Promise<{ data: T; lastUpdatedAt: number } | null> {
  const records = readBoundedRecords(await getOfflineCache<unknown>(cacheKey));
  const record = records.find((r) => r.key === entryKey);
  return record ? { data: record.data as T, lastUpdatedAt: record.lastSynced } : null;
}

/**
 * Stores one browsed entry (a weight class, a club, a filter) in a cache that
 * keeps only the `maxEntries` most recently written ones.
 *
 * Browse caches used to keep every entry ever viewed in one AsyncStorage blob,
 * so the blob, and the parse + stringify on every switch, only grew (120
 * ranking classes measured 1.7MB and ~30ms per switch). Writing an entry
 * again makes it the newest. Like `setOfflineCache`, a failed write is logged,
 * not thrown: the fresh data is still shown.
 */
export async function writeBoundedCacheEntry<T>(
  cacheKey: string,
  entryKey: string,
  data: T,
  maxEntries: number,
): Promise<{ data: T; lastUpdatedAt: number }> {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error(`Bounded cache ${cacheKey} needs maxEntries >= 1, got ${maxEntries}`);
  }
  const lastSynced = Date.now();
  const kept = readBoundedRecords(await getOfflineCache<unknown>(cacheKey)).filter(
    (r) => r.key !== entryKey,
  );
  const next: BoundedCacheRecord[] = [
    ...kept.slice(Math.max(0, kept.length - (maxEntries - 1))),
    { key: entryKey, data, lastSynced },
  ];
  await setOfflineCache(cacheKey, next);
  return { data, lastUpdatedAt: lastSynced };
}

/**
 * Caches filled by browsing (not by an explicit download), which the offline
 * screen's per-item rows do not list. "Delete All" and "Clear Cache" must
 * still remove them.
 */
export const BROWSE_CACHE_KEYS = [
  OFFLINE_CACHE_KEYS.nationalRankings,
  OFFLINE_CACHE_KEYS.clubs,
  OFFLINE_CACHE_KEYS.clubAthletes,
  OFFLINE_CACHE_KEYS.clubMeetStats,
  OFFLINE_CACHE_KEYS.wsoRecordsFiltered,
] as const;

/** Removes every browse cache (`BROWSE_CACHE_KEYS`). */
export async function clearBrowseCaches(): Promise<void> {
  for (const key of BROWSE_CACHE_KEYS) {
    await clearOfflineCache(key);
  }
}
