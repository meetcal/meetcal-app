import AsyncStorage from '@react-native-async-storage/async-storage';
import { createKeyedWriteChain } from '@/lib/data/write-chain';
import { isRecord } from '@/lib/is-record';
import { decodePersistedTag, encodePersistedTag } from '@/lib/database/persisted-tag';
import type { ReadCached } from './cached-shapes';

export type OfflineCacheEntry<T> = {
  data: T;
  lastSynced: number;
  tag?: string | null;
};

type StoredOfflineCacheEntry = {
  data: unknown;
  lastSynced: number;
  tag?: string;
};

export const OFFLINE_CACHE_KEYS = {
  standards: '@offline_cache/standards',
  qualifyingTotals: '@offline_cache/qualifying_totals',
  qualifyingTotalsBrowse: '@offline_cache/qualifying_totals_browse',
  qualifyingTotalCategories: '@offline_cache/qualifying_total_categories',
  intlRankings: '@offline_cache/intl_rankings',
  records: '@offline_cache/records',
  recordsBrowse: '@offline_cache/records_browse',
  wsoRecords: '@offline_cache/wso_records',
  wsoRecordsFiltered: '@offline_cache/wso_records_filtered',
  wsoList: '@offline_cache/wso_list',
  athleteResultsBrowse: '@offline_cache/athlete_results_browse',
  adaptiveRecords: '@offline_cache/adaptive_records',
  nationalRankings: '@offline_cache/national_rankings',
  clubs: '@offline_cache/clubs',
  // Club athlete lists cached before #209: read for their meets until a club
  // is browsed again (`fetch-club-stats`), and cleared with the browse caches.
  clubAthletes: '@offline_cache/club_athletes',
  clubMeets: '@offline_cache/club_meets',
  clubMeetStats: '@offline_cache/club_meet_stats',
} as const;

function isOfflineCacheEntry(value: unknown): value is StoredOfflineCacheEntry {
  if (!isRecord(value) || !('data' in value)) return false;
  return typeof value.lastSynced === 'number' && Number.isFinite(value.lastSynced);
}

function withTag<E extends object>(entry: E, tag: string | null): E & { tag?: string } {
  return tag === null ? entry : { ...entry, tag };
}

function storedEntry<T>(entry: OfflineCacheEntry<T>): StoredOfflineCacheEntry {
  const tag = encodePersistedTag(entry.tag);
  return tag === undefined
    ? { data: entry.data, lastSynced: entry.lastSynced }
    : { data: entry.data, lastSynced: entry.lastSynced, tag };
}

async function readStoredEntry(key: string): Promise<OfflineCacheEntry<unknown> | null> {
  try {
    const stored = await AsyncStorage.getItem(key);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (!isOfflineCacheEntry(parsed)) return null;
    const tag = typeof parsed.tag === 'string' ? parsed.tag : undefined;
    return withTag({ data: parsed.data, lastSynced: parsed.lastSynced }, decodePersistedTag(tag));
  } catch (error) {
    console.error('Error reading offline cache:', error);
    return null;
  }
}

export async function getOfflineCache<T>(
  key: string,
  read: ReadCached<T>,
): Promise<OfflineCacheEntry<T> | null> {
  const entry = await readStoredEntry(key);
  if (!entry) return null;
  const data = read(entry.data);
  return data === undefined ? null : withTag({ data, lastSynced: entry.lastSynced }, entry.tag ?? null);
}

export async function getOfflineCacheSyncedAt(key: string): Promise<number | null> {
  return (await readStoredEntry(key))?.lastSynced ?? null;
}

export async function setOfflineCache<T>(key: string, data: T, tag: string | null = null): Promise<OfflineCacheEntry<T>> {
  const entry: OfflineCacheEntry<T> = withTag({ data, lastSynced: Date.now() }, tag);
  try {
    await AsyncStorage.setItem(key, JSON.stringify(storedEntry(entry)));
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
export async function replaceOfflineCache<T>(key: string, data: T, tag: string | null = null): Promise<OfflineCacheEntry<T>> {
  const entry: OfflineCacheEntry<T> = withTag({ data, lastSynced: Date.now() }, tag);
  await AsyncStorage.setItem(key, JSON.stringify(storedEntry(entry)));
  return entry;
}

export async function clearOfflineCache(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch (error) {
    console.error('Error clearing offline cache:', error);
  }
}

/**
 * Serializes every write to a browse cache (`writeBoundedCacheEntry`,
 * `clearBrowseCaches`) per cache key, so each read-modify-write sees the
 * previous one's result and a clear waits for writes already queued.
 */
const browseCacheWrites = createKeyedWriteChain();

/** One entry of a bounded browse cache, with its own write time. */
type BoundedCacheRecord = { key: string; data: unknown; lastSynced: number; tag?: string };

function isBoundedCacheRecord(value: unknown): value is BoundedCacheRecord {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    'data' in value &&
    typeof value.lastSynced === 'number' &&
    Number.isFinite(value.lastSynced)
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
  if (isRecord(data)) {
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
  read: ReadCached<T>,
): Promise<{ data: T; lastUpdatedAt: number; tag?: string } | null> {
  const records = readBoundedRecords(await readStoredEntry(cacheKey));
  const record = records.find((r) => r.key === entryKey);
  if (!record) return null;
  const data = read(record.data);
  if (data === undefined) return null;
  return withTag({ data, lastUpdatedAt: record.lastSynced }, decodePersistedTag(record.tag));
}

/** The entry keys a browse cache written by `writeBoundedCacheEntry` holds. */
export async function readBoundedCacheKeys(cacheKey: string): Promise<string[]> {
  return readBoundedRecords(await readStoredEntry(cacheKey)).map((r) => r.key);
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
 *
 * The read-modify-write runs on `browseCacheWrites` under `cacheKey`: a
 * browse request persists after the screen may have moved to another entry,
 * so two writes to one blob can overlap, and the second used to drop the
 * first one's entry.
 */
export async function writeBoundedCacheEntry<T>(
  cacheKey: string,
  entryKey: string,
  data: T,
  maxEntries: number,
  tag: string | null = null,
): Promise<{ data: T; lastUpdatedAt: number; tag?: string }> {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error(`Bounded cache ${cacheKey} needs maxEntries >= 1, got ${maxEntries}`);
  }
  return browseCacheWrites(cacheKey, async () => {
    const lastSynced = Date.now();
    const kept = readBoundedRecords(await readStoredEntry(cacheKey)).filter(
      (r) => r.key !== entryKey,
    );
    const storedTag = encodePersistedTag(tag);
    const record: BoundedCacheRecord =
      storedTag === undefined ? { key: entryKey, data, lastSynced } : { key: entryKey, data, lastSynced, tag: storedTag };
    const next: BoundedCacheRecord[] = [...kept.slice(Math.max(0, kept.length - (maxEntries - 1))), record];
    await setOfflineCache(cacheKey, next);
    return withTag({ data, lastUpdatedAt: lastSynced }, tag);
  });
}

/**
 * Removes one entry from a cache written by `writeBoundedCacheEntry`, and the
 * cache itself once it holds none, on the same write chain.
 */
export async function removeBoundedCacheEntry(cacheKey: string, entryKey: string): Promise<void> {
  await browseCacheWrites(cacheKey, async () => {
    const entry = await readStoredEntry(cacheKey);
    if (!entry) return;
    const records = readBoundedRecords(entry);
    const kept = records.filter((r) => r.key !== entryKey);
    if (kept.length === records.length) return;
    if (kept.length === 0) await clearOfflineCache(cacheKey);
    else await setOfflineCache(cacheKey, kept);
  });
}

/**
 * Caches filled by browsing (not by an explicit download), which the offline
 * screen's per-item rows do not list. "Delete All" and "Clear Cache" must
 * still remove them.
 */
export const BROWSE_CACHE_KEYS = [
  OFFLINE_CACHE_KEYS.recordsBrowse,
  OFFLINE_CACHE_KEYS.nationalRankings,
  OFFLINE_CACHE_KEYS.clubs,
  OFFLINE_CACHE_KEYS.clubAthletes,
  OFFLINE_CACHE_KEYS.clubMeets,
  OFFLINE_CACHE_KEYS.clubMeetStats,
  OFFLINE_CACHE_KEYS.wsoRecordsFiltered,
  OFFLINE_CACHE_KEYS.wsoList,
  OFFLINE_CACHE_KEYS.athleteResultsBrowse,
  OFFLINE_CACHE_KEYS.qualifyingTotalsBrowse,
  OFFLINE_CACHE_KEYS.qualifyingTotalCategories,
] as const;

/**
 * Removes every browse cache (`BROWSE_CACHE_KEYS`). Each removal waits for
 * that key's queued writes: one that read the blob just before the clear
 * used to write the whole old blob back after it.
 */
export async function clearBrowseCaches(): Promise<void> {
  for (const key of BROWSE_CACHE_KEYS) {
    await browseCacheWrites(key, () => clearOfflineCache(key));
  }
}
