import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Schedule } from '@/types/schedule';
import type { LiftResult, SupabaseBests, SupabaseLiftResult } from '@/data/types/athletes';
import { MeetName } from '@/data/types/meet';
import { meetCalendarDateAnchor } from '@/utils/dateTime';
import { Buffer } from 'buffer';
import { deflate, inflate } from 'pako';
import {
  filterSessionAthletes,
  normalizeLiftResults,
  normalizeAthleteName,
  normalizePlatformKey,
} from '@/lib/athletes';


const STORE_KEY = 'meetcal_offline_store';
const SCHEDULE_KEY_PREFIX = 'meetcal_schedule_';
const ATHLETES_KEY_PREFIX = 'meetcal_athletes_';
const SESSION_ATHLETES_KEY_PREFIX = 'meetcal_session_athletes_';
const LIFTING_RESULTS_KEY_PREFIX = 'meetcal_lifting_results_';
const ATHLETE_HISTORY_KEY_PREFIX = 'meetcal_athlete_history_';
const ATHLETE_BESTS_KEY_PREFIX = 'meetcal_athlete_bests_';
const EXPLICIT_MEET_DOWNLOADS_KEY = 'meetcal_explicit_meet_downloads';
/**
 * `/meets/package` ETag per meet, owned by `meet-manager`. Declared here
 * because a `304` against it is only trustworthy while the athlete history it
 * vouches for is still on disk, and this module is what deletes that history.
 */
export const PACKAGE_ETAG_STORAGE_KEY = '@meet_package_etag_v1';
const LIFTING_RESULTS_CHUNK_SIZE = 180_000;

/**
 * Keys removed per `multiRemove`. AsyncStorage forwards the whole list to a
 * single native call, so a 4500-key delete would otherwise cross the bridge as
 * one unbounded batch (PoT #4 "declare sizes").
 */
const STORAGE_REMOVE_BATCH_SIZE = 500;
/** Keys read per `multiGet` when probing which athletes have a history blob. */
const STORAGE_READ_BATCH_SIZE = 500;
/**
 * Entries written per `multiSet`. The package's `year_bests_by_name` is
 * roster-sized (a national meet is well over a thousand names), and one
 * `multiSet` crosses the bridge as a single unbounded batch, like a remove.
 */
const STORAGE_WRITE_BATCH_SIZE = 500;
/**
 * Most chunk keys a lifting-results manifest may name: 256 x 180 KB is ~46 MB
 * of base64, far past any real athlete or meet blob. The count is read back
 * from storage and drives an `Array.from({ length })` and a key loop, so a
 * corrupt manifest (`chunks: 1e9`, `Infinity`, `1.5`) must be rejected rather
 * than allocate or iterate without bound.
 */
const MAX_LIFTING_RESULTS_CHUNKS = 256;
const LIFTING_RESULTS_FORMAT = 'deflate-base64-chunks-v1';

export interface MeetData {
  schedule: Schedule | null;
  scheduleKey: string;
  athletesKey: string;
  athletes: LiftResult[];
  liftingResultsKey: string;
  lastSyncTime: number;
  /**
   * When the roster alone was last written. `lastSyncTime` is also bumped by
   * schedule and results writes, so it cannot tell a fresh roster apart from
   * an old roster next to a fresh schedule.
   */
  athletesSyncedAt?: number;
}

type ExplicitMeetDownloadEntry = {
  markedAt: number;
  endDate?: string;
};

type ExplicitMeetDownloads = Record<string, ExplicitMeetDownloadEntry>;

async function getExplicitMeetDownloads(): Promise<ExplicitMeetDownloads> {
  try {
    const raw = await AsyncStorage.getItem(EXPLICIT_MEET_DOWNLOADS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);

    // Backward compatibility with older shape: string[]
    if (Array.isArray(parsed)) {
      return parsed.reduce<ExplicitMeetDownloads>((acc, value) => {
        if (typeof value !== 'string') return acc;
        acc[value] = { markedAt: 0 };
        return acc;
      }, {});
    }

    if (parsed && typeof parsed === 'object') {
      const entries = Object.entries(parsed as Record<string, unknown>);
      return entries.reduce<ExplicitMeetDownloads>((acc, [meetId, value]) => {
        if (!value || typeof value !== 'object') return acc;
        const entry = value as { markedAt?: unknown; endDate?: unknown };
        acc[meetId] = {
          markedAt:
            typeof entry.markedAt === 'number' ? entry.markedAt : Date.now(),
          ...(typeof entry.endDate === 'string' ? { endDate: entry.endDate } : {}),
        };
        return acc;
      }, {});
    }

    return {};
  } catch (error) {
    console.error('Error reading explicit meet downloads:', error);
    return {};
  }
}

async function saveExplicitMeetDownloads(downloads: ExplicitMeetDownloads): Promise<void> {
  try {
    await AsyncStorage.setItem(
      EXPLICIT_MEET_DOWNLOADS_KEY,
      JSON.stringify(downloads),
    );
  } catch (error) {
    console.error('Error saving explicit meet downloads:', error);
  }
}

export async function markMeetExplicitlyDownloaded(
  meetId: MeetName,
  downloaded: boolean,
  options?: { endDate?: string }
): Promise<void> {
  const downloads = await getExplicitMeetDownloads();
  if (downloaded) {
    downloads[meetId] = {
      markedAt: Date.now(),
      ...(options?.endDate ? { endDate: options.endDate } : {}),
    };
  } else {
    delete downloads[meetId];
  }
  await saveExplicitMeetDownloads(downloads);
}

export async function isMeetExplicitlyDownloaded(meetId: MeetName): Promise<boolean> {
  const downloads = await getExplicitMeetDownloads();
  return Boolean(downloads[meetId]);
}

/**
 * Every explicitly-downloaded meet id, read in a single AsyncStorage round
 * trip.
 *
 * Callers that need the answer for *many* meets (the offline-downloads screen,
 * cache eviction, implicit-cache cleanup) used to call
 * `isMeetExplicitlyDownloaded` once per meet, re-reading and re-`JSON.parse`ing
 * the same blob N times.
 */
export async function getExplicitlyDownloadedMeetIds(): Promise<Set<string>> {
  return new Set(Object.keys(await getExplicitMeetDownloads()));
}

// Pacific/Honolulu (UTC-10) is the westernmost timezone `USTimeZoneIdentifier`
// allows, and the download entry does not record which zone the meet is in.
// Treating the meet as ending at midnight in *that* zone means we may hold a
// finished East-coast meet's data ~15 hours longer than necessary, which is
// harmless — whereas `new Date(`${endDate}T23:59:59`)` uses the *device*
// timezone and would delete a Los Angeles meet's offline data at 9pm local on
// its final day for a user sitting in New York.
const WESTERNMOST_MEET_OFFSET_MS = 10 * 60 * 60 * 1000;
/** From the noon-UTC calendar anchor to midnight UTC starting the next day. */
const NOON_TO_NEXT_MIDNIGHT_MS = 12 * 60 * 60 * 1000;

function hasMeetEnded(endDate: string): boolean {
  const anchor = meetCalendarDateAnchor(endDate);
  if (!anchor) return false;
  // Noon UTC on the end date + 12h = midnight UTC starting the next day.
  const endOfMeetDay =
    anchor.getTime() + NOON_TO_NEXT_MIDNIGHT_MS + WESTERNMOST_MEET_OFFSET_MS;
  return endOfMeetDay < Date.now();
}

export async function clearExpiredDownloadedMeets(): Promise<void> {
  try {
    const downloads = await getExplicitMeetDownloads();
    const expiredMeetIds = Object.keys(downloads).filter((meetId) => {
      const endDate = downloads[meetId]?.endDate;
      return endDate ? hasMeetEnded(endDate) : false;
    });
    // This runs on every meets refresh — app start, every five minutes, and
    // every reconnect — and almost always finds nothing expired. Resolving
    // the key listing from the expired count keeps that common case free.
    const storageKeys = await readStorageKeysForMeetClear(expiredMeetIds.length);

    for (const meetId of expiredMeetIds) {
      await clearMeetData(meetId as MeetName, { storageKeys });
    }
  } catch (error) {
    console.error('Error clearing expired downloaded meets:', error);
  }
}

interface OfflineStore {
  meets: {
    [meetId: string]: MeetData;
  };
}

interface LiftingResultsManifest {
  format: typeof LIFTING_RESULTS_FORMAT;
  chunks: number;
  /**
   * Which chunk-key generation the manifest names. Each rewrite of a blob
   * bumps it so the new chunks land under keys the old manifest does not
   * reference: the old chunks stay readable until the new manifest is
   * written (the commit point) and are only removed after it. Absent on
   * manifests written before generations existed, which is generation 0.
   */
  generation?: number;
}

function getLiftingResultsChunkKey(
  baseKey: string,
  index: number,
  generation = 0,
): string {
  // Generation 0 keeps the pre-generation key shape so existing blobs on
  // devices stay readable without a migration.
  return generation === 0
    ? `${baseKey}__chunk_${index}`
    : `${baseKey}__chunk_${index}_g${generation}`;
}

function getManifestChunkKeys(baseKey: string, manifest: LiftingResultsManifest): string[] {
  const generation = manifest.generation ?? 0;
  return Array.from({ length: manifest.chunks }, (_, index) =>
    getLiftingResultsChunkKey(baseKey, index, generation),
  );
}

function isLiftingResultsManifest(value: unknown): value is LiftingResultsManifest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { format?: unknown; chunks?: unknown; generation?: unknown };
  return (
    candidate.format === LIFTING_RESULTS_FORMAT &&
    isBoundedChunkCount(candidate.chunks) &&
    (candidate.generation === undefined || isChunkGeneration(candidate.generation))
  );
}

function isChunkGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** The manifest a stored payload describes, or null for legacy/corrupt values. */
function parseLiftingResultsManifest(payload: string | null): LiftingResultsManifest | null {
  if (!payload) return null;
  try {
    const parsed: unknown = JSON.parse(payload);
    return isLiftingResultsManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** `multiGet` in `STORAGE_READ_BATCH_SIZE` slices, as one key → value map. */
async function multiGetBatched(keys: readonly string[]): Promise<Map<string, string | null>> {
  const values = new Map<string, string | null>();
  for (let offset = 0; offset < keys.length; offset += STORAGE_READ_BATCH_SIZE) {
    const slice = keys.slice(offset, offset + STORAGE_READ_BATCH_SIZE);
    const entries = await AsyncStorage.multiGet(slice);
    slice.forEach((key, index) => {
      values.set(key, entries[index]?.[1] ?? null);
    });
  }
  return values;
}

/** `multiRemove` in `STORAGE_REMOVE_BATCH_SIZE` slices; nothing for no keys. */
async function multiRemoveBatched(keys: readonly string[]): Promise<void> {
  for (let offset = 0; offset < keys.length; offset += STORAGE_REMOVE_BATCH_SIZE) {
    await AsyncStorage.multiRemove(keys.slice(offset, offset + STORAGE_REMOVE_BATCH_SIZE));
  }
}

/** `multiSet` in `STORAGE_WRITE_BATCH_SIZE` slices, in order; nothing for no pairs. */
async function multiSetBatched(pairs: readonly [string, string][]): Promise<void> {
  for (let offset = 0; offset < pairs.length; offset += STORAGE_WRITE_BATCH_SIZE) {
    await AsyncStorage.multiSet(pairs.slice(offset, offset + STORAGE_WRITE_BATCH_SIZE));
  }
}

function isBoundedChunkCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_LIFTING_RESULTS_CHUNKS
  );
}

/**
 * A cached lifting-result row the readers can use. `name` is the only field
 * every consumer dereferences (`normalizeAthleteName(r.name)`); the rest are
 * read defensively. Anything else — a number, `null`, a bare string — is a
 * corrupt entry and is dropped rather than left to throw in a `.filter`.
 */
function isCachedLiftResult(value: unknown): value is SupabaseLiftResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { name?: unknown }).name === 'string'
  );
}

function toCachedLiftResults(rows: readonly unknown[]): SupabaseLiftResult[] {
  const valid = rows.filter(isCachedLiftResult);
  if (valid.length !== rows.length) {
    console.warn(
      `Dropped ${rows.length - valid.length} malformed cached lifting result rows`,
    );
  }
  return valid;
}

function splitIntoChunks(value: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += chunkSize) {
    chunks.push(value.slice(i, i + chunkSize));
  }
  return chunks;
}

function encodeLiftingResults(results: SupabaseLiftResult[]): string {
  const json = JSON.stringify(results);
  const compressed = deflate(json);
  return Buffer.from(compressed).toString('base64');
}

function decodeLiftingResults(encoded: string): SupabaseLiftResult[] {
  const bytes = Buffer.from(encoded, 'base64');
  const inflated = inflate(bytes);
  const json = Buffer.from(inflated).toString();
  const parsed: unknown = JSON.parse(json);
  // A truncated chunk set can still inflate to valid JSON that is not a row
  // array. `as SupabaseLiftResult[]` let that reach every caller's `.filter`
  // and `.map`; the readers below turn a throw here into "no cached results",
  // which is the correct degradation.
  if (!Array.isArray(parsed)) {
    throw new Error('Cached lifting results payload was not an array');
  }
  return toCachedLiftResults(parsed);
}

async function clearStoredLiftingResultsValue(liftingResultsKey: string): Promise<void> {
  const current = await AsyncStorage.getItem(liftingResultsKey);
  if (!current) {
    return;
  }

  const manifest = parseLiftingResultsManifest(current);
  if (manifest) {
    await AsyncStorage.multiRemove([
      liftingResultsKey,
      ...getManifestChunkKeys(liftingResultsKey, manifest),
    ]);
    return;
  }

  // Legacy raw payload or corrupt manifest: a single-key remove.
  await AsyncStorage.removeItem(liftingResultsKey);
}

async function readStoredLiftingResults(
  liftingResultsKey: string,
): Promise<SupabaseLiftResult[]> {
  const payload = await AsyncStorage.getItem(liftingResultsKey);
  if (!payload) {
    return [];
  }

  try {
    const parsed = JSON.parse(payload) as unknown;

    if (Array.isArray(parsed)) {
      return toCachedLiftResults(parsed);
    }

    if (!isLiftingResultsManifest(parsed) || parsed.chunks <= 0) {
      return [];
    }

    const chunkKeys = getManifestChunkKeys(liftingResultsKey, parsed);
    const chunkEntries = await AsyncStorage.multiGet(chunkKeys);
    const chunkValues = chunkEntries.map(([, value]) => value ?? '');

    const emptyChunks = chunkValues.filter((v) => v.length === 0).length;
    if (emptyChunks > 0) {
      return [];
    }

    return decodeLiftingResults(chunkValues.join(''));
  } catch (error) {
    console.error('Error reading stored lifting results:', error);
    return [];
  }
}

type LiftingResultsWrite = {
  key: string;
  results: SupabaseLiftResult[];
};

/** One blob's planned rewrite inside a batch. */
type PlannedLiftingResultsWrite = {
  key: string;
  /** The manifest value on disk before this write, restored if the write fails. */
  previousPayload: string | null;
  /** Chunk keys the previous manifest named; removed only after the new manifest lands. */
  previousChunkKeys: string[];
  chunkKeys: string[];
  chunks: string[];
  manifestPayload: string;
};

/**
 * Writes several lifting-results blobs (meet results or per-athlete history)
 * with a bounded number of storage calls and a crash-safe order.
 *
 * Why batched: iOS AsyncStorage keeps every value of 1 KB or less inline in
 * one `manifest.json` and rewrites that whole file on every `setItem`/
 * `multiSet` that touches an inline key. Per-athlete history chunks and
 * manifests are almost all inline, so writing a 1,500-athlete roster one
 * `setItem` at a time rewrote a multi-megabyte file ~3,000 times, serialized
 * on the storage queue in front of every other read. One `multiSet` per
 * batch rewrites it once.
 *
 * Why this order (the manifest is the commit point):
 *   1. read the current manifests and, for unchanged blobs, skip the write
 *      entirely (the daily history refresh mostly rewrites identical rows);
 *   2. one `multiSet` of every new chunk followed by every new manifest, the
 *      chunks under a fresh generation of keys so nothing the old manifest
 *      references is touched;
 *   3. one read-back of what was written, so a chunk that did not persist is
 *      caught before the old chunks go;
 *   4. one `multiRemove` of the chunk keys only the old manifests named.
 * A failure in 2 or 3 restores the previous manifests, which still point at
 * the previous chunks, so an interrupted download leaves each athlete with
 * the copy it had rather than nothing. This used to be clear-then-write.
 *
 * @returns how many blobs were rewritten (the rest were byte-identical).
 */
async function writeStoredLiftingResultsBatch(
  writes: readonly LiftingResultsWrite[],
): Promise<number> {
  if (writes.length === 0) return 0;
  const keys = writes.map((write) => write.key);
  const previousPayloads = await multiGetBatched(keys);

  const encodedByKey = new Map<string, string>();
  const previousManifests = new Map<string, LiftingResultsManifest>();
  const previousChunkKeys: string[] = [];
  for (const write of writes) {
    encodedByKey.set(write.key, encodeLiftingResults(write.results));
    const previous = parseLiftingResultsManifest(previousPayloads.get(write.key) ?? null);
    if (previous) {
      previousManifests.set(write.key, previous);
      previousChunkKeys.push(...getManifestChunkKeys(write.key, previous));
    }
  }

  // Read the old chunks once, compare encoded to encoded (no inflate), and
  // drop every blob whose bytes are already on disk.
  const previousChunks = await multiGetBatched(previousChunkKeys);
  const planned: PlannedLiftingResultsWrite[] = [];
  for (const write of writes) {
    const encoded = encodedByKey.get(write.key) ?? '';
    const previous = previousManifests.get(write.key) ?? null;
    const oldChunkKeys = previous ? getManifestChunkKeys(write.key, previous) : [];
    if (previous) {
      const oldChunks = oldChunkKeys.map((chunkKey) => previousChunks.get(chunkKey));
      if (oldChunks.every((chunk) => typeof chunk === 'string') && oldChunks.join('') === encoded) {
        continue;
      }
    }
    const chunks = splitIntoChunks(encoded, LIFTING_RESULTS_CHUNK_SIZE);
    if (chunks.length > MAX_LIFTING_RESULTS_CHUNKS) {
      throw new Error(
        `Lifting results for ${write.key} need ${chunks.length} chunks (max ${MAX_LIFTING_RESULTS_CHUNKS})`,
      );
    }
    const generation = previous ? (previous.generation ?? 0) + 1 : 0;
    const manifest: LiftingResultsManifest = {
      format: LIFTING_RESULTS_FORMAT,
      chunks: chunks.length,
      ...(generation > 0 ? { generation } : {}),
    };
    planned.push({
      key: write.key,
      previousPayload: previousPayloads.get(write.key) ?? null,
      previousChunkKeys: oldChunkKeys,
      chunkKeys: chunks.map((_, index) =>
        getLiftingResultsChunkKey(write.key, index, generation),
      ),
      chunks,
      manifestPayload: JSON.stringify(manifest),
    });
  }
  if (planned.length === 0) return 0;

  // Chunks first, manifests last, so a partial native write (iOS writes the
  // pairs in order and reports the first failure at the end) can only leave
  // a manifest unwritten, never a manifest naming chunks that are not there.
  const pairs: [string, string][] = [];
  for (const plan of planned) {
    plan.chunkKeys.forEach((chunkKey, index) => pairs.push([chunkKey, plan.chunks[index]]));
  }
  for (const plan of planned) {
    pairs.push([plan.key, plan.manifestPayload]);
  }

  try {
    await multiSetBatched(pairs);
    const written = await multiGetBatched(
      planned.flatMap((plan) => [...plan.chunkKeys, plan.key]),
    );
    for (const plan of planned) {
      const missingChunk = plan.chunkKeys.findIndex((chunkKey) => !written.get(chunkKey));
      if (missingChunk !== -1) {
        throw new Error(`Chunk ${missingChunk} failed to persist for ${plan.key}`);
      }
      if (written.get(plan.key) !== plan.manifestPayload) {
        throw new Error(`Manifest failed to persist for ${plan.key}`);
      }
    }
  } catch (error) {
    await restorePreviousManifests(planned);
    throw error;
  }

  const currentChunkKeys = new Set(planned.flatMap((plan) => plan.chunkKeys));
  await multiRemoveBatched(
    planned.flatMap((plan) =>
      plan.previousChunkKeys.filter((chunkKey) => !currentChunkKeys.has(chunkKey)),
    ),
  );
  return planned.length;
}

/**
 * Points every blob of a failed batch back at the copy it had: the previous
 * manifest (or raw payload) where there was one, no manifest where there was
 * none. The previous chunks were never touched, so this is enough. Best
 * effort: the write failed for a reason (`SQLITE_FULL`, most likely) that may
 * fail this too, and the original error is what the caller needs to see.
 */
async function restorePreviousManifests(planned: readonly PlannedLiftingResultsWrite[]): Promise<void> {
  const restore: [string, string][] = [];
  const remove: string[] = [];
  for (const plan of planned) {
    if (plan.previousPayload !== null) restore.push([plan.key, plan.previousPayload]);
    else remove.push(plan.key);
  }
  try {
    await multiSetBatched(restore);
    await multiRemoveBatched(remove);
  } catch (restoreError) {
    console.error('Could not restore previous lifting results manifests:', restoreError);
  }
}

async function writeStoredLiftingResults(
  liftingResultsKey: string,
  liftingResults: SupabaseLiftResult[],
): Promise<void> {
  await writeStoredLiftingResultsBatch([{ key: liftingResultsKey, results: liftingResults }]);
}

async function readStoredAthletes(athletesKey: string, fallback: LiftResult[]): Promise<LiftResult[]> {
  try {
    const athletesString = await AsyncStorage.getItem(athletesKey);
    if (!athletesString) {
      return fallback;
    }
    const parsed: unknown = JSON.parse(athletesString);
    return Array.isArray(parsed) ? normalizeLiftResults(parsed) : fallback;
  } catch (error) {
    console.error('Error reading stored athletes:', error);
    return fallback;
  }
}

// Initialize store if it doesn't exist
export async function initStore(): Promise<void> {
  try {
    const store = await AsyncStorage.getItem(STORE_KEY);
    if (!store) {
      const initialStore: OfflineStore = {
        meets: {}
      };
      await AsyncStorage.setItem(STORE_KEY, JSON.stringify(initialStore));
    }
  } catch (error) {
    console.error('Error initializing store:', error);
  }
}

// Get meet data from store
export async function getMeetData(meetId: MeetName): Promise<MeetData> {
  try {
    const store = await getStore();

    if (!store.meets[meetId]) {
      const scheduleKey = `${SCHEDULE_KEY_PREFIX}${meetId}`;
      const athletesKey = `${ATHLETES_KEY_PREFIX}${meetId}`;
      const liftingResultsKey = `${LIFTING_RESULTS_KEY_PREFIX}${meetId}`;
      store.meets[meetId] = {
        schedule: null,
        scheduleKey,
        athletesKey,
        athletes: [],
        liftingResultsKey,
        lastSyncTime: 0
      };
      try {
        await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
      } catch (metadataError) {
        console.warn('Initialized meet metadata in memory but failed to persist store:', metadataError);
      }
    }
    
    // Get the schedule if it exists
    const scheduleKey = store.meets[meetId].scheduleKey;
    let schedule: Schedule | null = null;
    
    if (scheduleKey) {
      const scheduleString = await AsyncStorage.getItem(scheduleKey);
      if (scheduleString) {
        // A truncated or legacy payload must degrade to "no cached schedule",
        // not take the whole meet down: `MeetData.schedule` is typed
        // `Schedule | null`, and the sibling reader `getMeetSchedule` already
        // guards exactly this way.
        try {
          const parsed: unknown = JSON.parse(scheduleString);
          schedule = Array.isArray(parsed) ? (parsed as Schedule) : null;
        } catch (parseError) {
          console.warn('Ignoring invalid cached schedule payload:', parseError);
          schedule = null;
        }
      }
    }
    
    const athletesKey = store.meets[meetId].athletesKey || `${ATHLETES_KEY_PREFIX}${meetId}`;
    const athletes = await readStoredAthletes(
      athletesKey,
      Array.isArray(store.meets[meetId].athletes) ? normalizeLiftResults(store.meets[meetId].athletes) : [],
    );

    return {
      schedule,
      scheduleKey: store.meets[meetId].scheduleKey,
      athletesKey,
      athletes,
      liftingResultsKey: store.meets[meetId].liftingResultsKey,
      lastSyncTime: store.meets[meetId].lastSyncTime,
      athletesSyncedAt: store.meets[meetId].athletesSyncedAt ?? 0,
    };
  } catch (error) {
    console.error('Error getting meet data:', error);
    throw error;
  }
}

function getAthleteHistoryKey(normalizedName: string): string {
  return `${ATHLETE_HISTORY_KEY_PREFIX}${normalizedName}`;
}

function getAthleteBestsKey(normalizedName: string): string {
  return `${ATHLETE_BESTS_KEY_PREFIX}${normalizedName}`;
}

export async function saveAthleteHistory(
  athleteName: string,
  results: SupabaseLiftResult[],
): Promise<void> {
  await saveAthleteHistoryBatch([{ name: athleteName, results }]);
}

export type AthleteHistoryEntry = {
  name: string;
  results: SupabaseLiftResult[];
};

/**
 * Persists several athletes' histories with one `multiSet`, one read-back and
 * one `multiRemove` for the whole batch (see `writeStoredLiftingResultsBatch`),
 * skipping athletes whose stored bytes already match. The history download
 * calls this once per `/lifting-results/by-names` batch; per-athlete calls
 * cost one manifest rewrite each on iOS.
 *
 * Two spellings of one name (the API folds them the same way) collapse to a
 * single write, the last one winning.
 *
 * @returns how many athletes were actually rewritten.
 */
export async function saveAthleteHistoryBatch(
  entries: readonly AthleteHistoryEntry[],
): Promise<number> {
  try {
    const writesByKey = new Map<string, LiftingResultsWrite>();
    for (const entry of entries) {
      const normalized = normalizeAthleteName(entry.name);
      if (normalized.length === 0) continue;
      writesByKey.set(getAthleteHistoryKey(normalized), {
        key: getAthleteHistoryKey(normalized),
        results: entry.results,
      });
    }
    return await writeStoredLiftingResultsBatch(Array.from(writesByKey.values()));
  } catch (error) {
    console.error('Error saving athlete history:', error);
    throw error;
  }
}

/**
 * The subset of `athleteNames` with no history blob on disk. Reads only the
 * per-athlete manifest keys (a few dozen bytes each), in bounded batches, so
 * a roster-wide probe never inflates a single result row.
 */
export async function findAthleteNamesWithoutHistory(
  athleteNames: readonly string[],
): Promise<string[]> {
  const uniqueNames = Array.from(new Set(athleteNames.filter(Boolean)));
  const missing: string[] = [];
  for (let offset = 0; offset < uniqueNames.length; offset += STORAGE_READ_BATCH_SIZE) {
    const batch = uniqueNames.slice(offset, offset + STORAGE_READ_BATCH_SIZE);
    const entries = await AsyncStorage.multiGet(
      batch.map((name) => getAthleteHistoryKey(normalizeAthleteName(name))),
    );
    batch.forEach((name, index) => {
      const payload = entries[index]?.[1];
      if (!payload) missing.push(name);
    });
  }
  return missing;
}

function normalizeCachedBests(value: unknown): SupabaseBests | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<SupabaseBests>;
  return {
    snatch_best: typeof row.snatch_best === 'number' ? row.snatch_best : null,
    cj_best: typeof row.cj_best === 'number' ? row.cj_best : null,
    total: typeof row.total === 'number' ? row.total : null,
  };
}

export async function saveAthleteBestsBatch(
  bestsByName: Record<string, SupabaseBests>,
): Promise<void> {
  try {
    const entries = Object.entries(bestsByName)
      .filter(([athleteName]) => normalizeAthleteName(athleteName).length > 0)
      .map(([athleteName, bests]) => [
        getAthleteBestsKey(normalizeAthleteName(athleteName)),
        JSON.stringify(bests),
      ] as [string, string]);

    for (let offset = 0; offset < entries.length; offset += STORAGE_WRITE_BATCH_SIZE) {
      await AsyncStorage.multiSet(entries.slice(offset, offset + STORAGE_WRITE_BATCH_SIZE));
    }
  } catch (error) {
    console.error('Error saving athlete bests:', error);
    throw error;
  }
}

export async function getCachedAthleteBestsForNames(
  athleteNames: string[],
): Promise<Record<string, SupabaseBests | undefined>> {
  const uniqueNames = Array.from(new Set(athleteNames.filter(Boolean)));
  const keysByName = uniqueNames.map((name) => ({
    name,
    key: getAthleteBestsKey(normalizeAthleteName(name)),
  }));

  try {
    const entries = await AsyncStorage.multiGet(keysByName.map(({ key }) => key));
    return entries.reduce<Record<string, SupabaseBests | undefined>>(
      (acc, [, payload], index) => {
        const name = keysByName[index]?.name;
        if (!name || !payload) return acc;

        try {
          acc[name] = normalizeCachedBests(JSON.parse(payload)) ?? undefined;
        } catch {
          acc[name] = undefined;
        }
        return acc;
      },
      {},
    );
  } catch (error) {
    console.error('Error getting cached athlete bests:', error);
    return {};
  }
}

/**
 * Cached competition history for several athletes at once.
 *
 * Per athlete the rules are unchanged: the athlete's own history blob wins
 * outright, and only athletes without one fall through to scanning the cached
 * meets' results.
 *
 * What changes is the loop order. Resolving athletes one at a time meant every
 * athlete re-read, base64-decoded, pako-inflated and `JSON.parse`d *every*
 * cached meet's results blob (`getAthleteLiftingResults` also re-read the
 * store, the meet schedule and the full roster on each call, and threw all
 * three away). A 15-athlete session against three downloaded meets did 45 full
 * meet decompressions to answer 15 questions. Meets are the outer loop here,
 * so it does three.
 *
 * Peak memory is unchanged: the scan is still sequential and still holds one
 * inflated meet blob at a time. Do NOT turn this into a `Promise.all` over
 * meets — concurrent pako inflates of meet-sized payloads are what the iOS
 * watchdog punishes.
 */
export async function getAllCachedLiftingResultsForAthletes(
  athleteNames: string[],
): Promise<Record<string, SupabaseLiftResult[]>> {
  const uniqueNames = Array.from(new Set(athleteNames));
  const byName: Record<string, SupabaseLiftResult[]> = {};
  if (uniqueNames.length === 0) return byName;

  const needsMeetScan: string[] = [];
  for (const athleteName of uniqueNames) {
    byName[athleteName] = [];
    try {
      const fromHistory = await readStoredLiftingResults(
        getAthleteHistoryKey(normalizeAthleteName(athleteName)),
      );
      if (fromHistory.length > 0) {
        byName[athleteName] = fromHistory;
        continue;
      }
    } catch (error) {
      console.error('Error getting cached lifting results for athlete:', error);
      continue;
    }
    needsMeetScan.push(athleteName);
  }

  if (needsMeetScan.length === 0) return byName;

  try {
    const store = await getStore();
    const meetIds = Object.keys(store.meets);

    // Per-athlete dedupe state, mirroring the single-athlete scan exactly.
    const seenByName = new Map<string, Set<string>>();
    const rowIndexByName = new Map<string, number>();
    // One normalized name can be requested under several spellings.
    const namesByNormalized = new Map<string, string[]>();
    for (const athleteName of needsMeetScan) {
      seenByName.set(athleteName, new Set());
      rowIndexByName.set(athleteName, 0);
      const normalized = normalizeAthleteName(athleteName);
      const bucket = namesByNormalized.get(normalized);
      if (bucket) bucket.push(athleteName);
      else namesByNormalized.set(normalized, [athleteName]);
    }

    for (const meetId of meetIds) {
      const liftingResultsKey = store.meets[meetId as MeetName]?.liftingResultsKey;
      if (!liftingResultsKey) continue;

      const meetResults = await readStoredLiftingResults(liftingResultsKey);
      for (const r of meetResults) {
        const targets = namesByNormalized.get(normalizeAthleteName(r.name));
        if (!targets) continue;
        // `||`, not `??`: an `event_id` of `''` is "no id", and `??` kept it,
        // collapsing every id-less row into the same `-date-name` key.
        const baseKey = `${r.event_id || r.meet}-${r.date}-${r.name}`;
        const isSentinelKey = baseKey === 'undefined-undefined-undefined';
        for (const athleteName of targets) {
          const seen = seenByName.get(athleteName)!;
          let dedupeKey = baseKey;
          if (isSentinelKey) {
            const rowIndex = rowIndexByName.get(athleteName)!;
            dedupeKey = `${baseKey}-${rowIndex}`;
            rowIndexByName.set(athleteName, rowIndex + 1);
          }
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          byName[athleteName].push(r);
        }
      }
    }

    for (const athleteName of needsMeetScan) {
      byName[athleteName].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    }
  } catch (error) {
    console.error('Error getting cached lifting results for athlete:', error);
    for (const athleteName of needsMeetScan) {
      byName[athleteName] = [];
    }
  }

  return byName;
}

export async function getAllCachedLiftingResultsForAthlete(
  athleteName: string,
): Promise<SupabaseLiftResult[]> {
  const byName = await getAllCachedLiftingResultsForAthletes([athleteName]);
  return byName[athleteName] ?? [];
}

export async function getAthleteLiftingResults(meetId: MeetName, athleteName: string): Promise<SupabaseLiftResult[]> {
  try {
    const meetData = await getMeetData(meetId);
    const liftingResultsKey = meetData.liftingResultsKey;
    
    if (!liftingResultsKey) {
      return [];
    }
    
    const allResults = await readStoredLiftingResults(liftingResultsKey);
    const normalizedTargetName = normalizeAthleteName(athleteName);
    const filteredResults = allResults.filter(
      result => normalizeAthleteName(result.name) === normalizedTargetName
    );

    return filteredResults;
  } catch (error) {
    console.error('Error getting athlete lifting results:', error);
    return [];
  }
}

// Get all cached lifting results for a meet
export async function getMeetLiftingResults(meetId: MeetName): Promise<SupabaseLiftResult[]> {
  try {
    const meetData = await getMeetData(meetId);
    const liftingResultsKey = meetData.liftingResultsKey;

    if (!liftingResultsKey) {
      return [];
    }

    return await readStoredLiftingResults(liftingResultsKey);
  } catch (error) {
    console.error('Error getting meet lifting results:', error);
    return [];
  }
}

function getSessionAthletesKey(
  meetId: MeetName | string,
  sessionNumber: number,
  platform: string,
): string {
  return `${SESSION_ATHLETES_KEY_PREFIX}${encodeURIComponent(meetId)}:${sessionNumber}:${encodeURIComponent(normalizePlatformKey(platform))}`;
}

function groupAthletesBySession(athletes: LiftResult[]) {
  const groups = new Map<string, LiftResult[]>();

  athletes.forEach((athlete) => {
    const session = athlete.session;
    if (!session) return;

    const key = `${session.number}:${normalizePlatformKey(session.platform)}`;
    const group = groups.get(key) ?? [];
    group.push(athlete);
    groups.set(key, group);
  });

  return groups;
}

export async function saveSessionAthletes(
  meetId: MeetName | string,
  sessionNumber: number,
  platform: string,
  athletes: LiftResult[],
): Promise<void> {
  try {
    const key = getSessionAthletesKey(meetId, sessionNumber, platform);
    await AsyncStorage.setItem(key, JSON.stringify(athletes));
  } catch (error) {
    console.error('Error saving session athletes:', error);
    throw error;
  }
}

async function saveSessionAthleteCaches(
  meetId: MeetName | string,
  athletes: LiftResult[],
): Promise<void> {
  const grouped = groupAthletesBySession(athletes);
  if (grouped.size === 0) return;

  const entries = Array.from(grouped.entries()).map(([groupKey, group]) => {
    const [sessionNumber, platform] = groupKey.split(':');
    return [
      getSessionAthletesKey(meetId, Number(sessionNumber), platform),
      JSON.stringify(group),
    ] as [string, string];
  });

  await AsyncStorage.multiSet(entries);
}

// Get athletes for a specific session/platform from cached meet data
export async function getSessionAthletesFromMeetCache(
  meetId: MeetName,
  sessionNumber: number,
  platform: string
): Promise<LiftResult[]> {
  try {
    const sessionPayload = await AsyncStorage.getItem(
      getSessionAthletesKey(meetId, sessionNumber, platform),
    );
    if (sessionPayload) {
      const parsed: unknown = JSON.parse(sessionPayload);
      const normalized = Array.isArray(parsed) ? normalizeLiftResults(parsed) : [];
      if (Array.isArray(parsed) && parsed.length > 0 && normalized.length === parsed.length) {
        const athletes = filterSessionAthletes(normalized, sessionNumber, platform);
        if (athletes.length > 0) return athletes;
      }
    }

  } catch (error) {
    console.error('Error getting session athletes from cache:', error);
  }

  // Empty or corrupt session entries can lag behind the full roster. Keep
  // the one full-meet fallback here so callers do not decode it twice.
  try {
    const meetData = await getMeetData(meetId);
    return filterSessionAthletes(meetData.athletes, sessionNumber, platform);
  } catch (error) {
    console.error('Error getting session athletes from meet cache:', error);
    return [];
  }
}

// Save meet schedule to store
export async function saveMeetSchedule(meetId: string, schedule: Schedule): Promise<void> {
  try {
    
    // Validate schedule structure
    if (!Array.isArray(schedule)) {
      console.error('Invalid schedule format: not an array');
      throw new Error('Invalid schedule format');
    }

    if (schedule.length === 0) {
      console.error('Invalid schedule: empty array');
      throw new Error('Empty schedule');
    }

    // Validate each day's structure
    schedule.forEach((day, index) => {
      if (!day.date || !day.fullDate || !Array.isArray(day.sessions)) {
        console.error(`Invalid day structure at index ${index}:`, day);
        throw new Error(`Invalid day structure at index ${index}`);
      }

      // Only the fields that make a session addressable. `startTime` and
      // `weighInTime` are legitimately "" when the API row has no time or an
      // unparseable one (`formatApiTime` documents that), and requiring them
      // made one blank row throw the whole schedule away — "No schedule yet"
      // for every session in the meet.
      day.sessions.forEach((session, sessionIndex) => {
        if (!session.id || !session.number || !Array.isArray(session.platforms)) {
          console.error(`Invalid session structure at day ${index}, session ${sessionIndex}:`, session);
          throw new Error(`Invalid session structure at day ${index}, session ${sessionIndex}`);
        }
      });
    });

    // Save schedule separately. `SyncManager` re-saves the same schedule every
    // 5 minutes for as long as a meet is selected, and a meet's schedule
    // almost never changes mid-event, so compare before writing (PoT #2/#3).
    // The `getStore()` read below means this path already pays for a read;
    // one more avoids an unconditional multi-kilobyte write every tick.
    const scheduleKey = `${SCHEDULE_KEY_PREFIX}${meetId}`;
    const scheduleString = JSON.stringify(schedule);
    const existingSchedule = await AsyncStorage.getItem(scheduleKey);
    if (existingSchedule !== scheduleString) {
      await AsyncStorage.setItem(scheduleKey, scheduleString);
    }

    // Get current store state
    const store = await getStore();
    
    // Update meet metadata: ONLY store the key and sync time, NOT the full schedule object
    const currentAthletesKey = store.meets[meetId]?.athletesKey || `${ATHLETES_KEY_PREFIX}${meetId}`;
    const currentLiftingResultsKey = store.meets[meetId]?.liftingResultsKey || `${LIFTING_RESULTS_KEY_PREFIX}${meetId}`;
    store.meets[meetId] = {
      schedule: null,
      scheduleKey: scheduleKey,
      athletesKey: currentAthletesKey,
      athletes: [],
      liftingResultsKey: currentLiftingResultsKey,
      lastSyncTime: Date.now(),
      athletesSyncedAt: store.meets[meetId]?.athletesSyncedAt ?? 0,
    };
    
    // Save the updated store metadata (now much smaller)
    const storeString = JSON.stringify(store);
    try {
      await AsyncStorage.setItem(STORE_KEY, storeString);
    } catch (metadataError) {
      console.warn('Saved schedule payload but failed to update store metadata:', metadataError);
    }


  } catch (error) {
    console.error('Error saving meet schedule:', error);
    throw error;
  }
}

export async function clearMeetSchedule(meetId: string): Promise<void> {
  try {
    const scheduleKey = `${SCHEDULE_KEY_PREFIX}${meetId}`;
    await AsyncStorage.removeItem(scheduleKey);

    const store = await getStore();
    const currentAthletesKey =
      store.meets[meetId]?.athletesKey || `${ATHLETES_KEY_PREFIX}${meetId}`;
    const currentLiftingResultsKey =
      store.meets[meetId]?.liftingResultsKey ||
      `${LIFTING_RESULTS_KEY_PREFIX}${meetId}`;

    store.meets[meetId] = {
      schedule: null,
      scheduleKey,
      athletesKey: currentAthletesKey,
      athletes: [],
      liftingResultsKey: currentLiftingResultsKey,
      lastSyncTime: Date.now(),
      athletesSyncedAt: store.meets[meetId]?.athletesSyncedAt ?? 0,
    };

    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (error) {
    console.error('Error clearing meet schedule:', error);
    throw error;
  }
}

export async function getMeetSchedule(meetId: string): Promise<Schedule> {
  try {
    // `getMeetData` has already read `scheduleKey` and parsed it into
    // `MeetData.schedule`, applying the same "not an array / bad JSON means no
    // cached schedule" rule this function used to apply itself. Re-reading the
    // key here was a second AsyncStorage read and a second `JSON.parse` of the
    // exact same payload.
    const meetData = await getMeetData(meetId as MeetName);
    return meetData.schedule ?? [];
  } catch (error) {
    console.error('Error getting meet schedule:', error);
    return [];
  }
}

// Save meet athletes to store
export async function saveMeetAthletes(meetId: string, athletes: LiftResult[]): Promise<void> {
  try {
    const athletesKey = `${ATHLETES_KEY_PREFIX}${meetId}`;
    const existingPayload = await AsyncStorage.getItem(athletesKey);
    let existingAthletes: LiftResult[] = [];
    if (existingPayload) {
      try {
        const parsed: unknown = JSON.parse(existingPayload);
        existingAthletes = Array.isArray(parsed) ? normalizeLiftResults(parsed) : [];
      } catch (parseError) {
        console.warn('Ignoring invalid cached athlete payload:', parseError);
      }
    }
    // Use the same identity policy as the session/history caches.
    const athleteKey = (athlete: LiftResult) =>
      athlete.memberId || normalizeAthleteName(athlete.name);
    const existingByKey = new Map(
      existingAthletes.map((athlete) => [athleteKey(athlete), athlete]),
    );
    const mergedAthletes = athletes.map((athlete) => {
      if (athlete.session) return athlete;
      const existing = existingByKey.get(athleteKey(athlete));
      return existing?.session
        ? {
            ...athlete,
            session: existing.session,
          }
        : athlete;
    });
    // PoT #2/#3 (bounded work): opening a meet re-saved the whole roster blob
    // (~0.5MB) plus one key per session/platform on every visit, even when the
    // API returned byte-identical rows. The previous payload is already in
    // hand for the session merge above, so the comparison is free.
    const mergedPayload = JSON.stringify(mergedAthletes);
    const payloadUnchanged = mergedPayload === existingPayload;
    if (!payloadUnchanged) {
      await AsyncStorage.setItem(athletesKey, mergedPayload);
      await saveSessionAthleteCaches(meetId, mergedAthletes);
    }

    // The store metadata write is small and `lastSyncTime` drives staleness,
    // so it still happens on every call.
    const store = await getStore();
    if (!store.meets[meetId]) {
      const scheduleKey = `${SCHEDULE_KEY_PREFIX}${meetId}`;
      const liftingResultsKey = `${LIFTING_RESULTS_KEY_PREFIX}${meetId}`;
      store.meets[meetId] = {
        schedule: null,
        scheduleKey,
        athletesKey,
        athletes: [],
        liftingResultsKey,
        lastSyncTime: Date.now()
      };
    }
    store.meets[meetId].athletesKey = athletesKey;
    store.meets[meetId].athletes = [];
    store.meets[meetId].lastSyncTime = Date.now();
    store.meets[meetId].athletesSyncedAt = Date.now();
    try {
      await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (metadataError) {
      console.warn('Saved athletes payload but failed to update store metadata:', metadataError);
    }
  } catch (error) {
    console.error('Error saving meet athletes:', error);
    throw error;
  }
}

// Save lifting results for all athletes in a meet
export async function saveMeetLiftingResults(meetId: string, liftingResults: SupabaseLiftResult[]): Promise<void> {
  try {
    const liftingResultsKey = `${LIFTING_RESULTS_KEY_PREFIX}${meetId}`;

    if (liftingResults.length === 0) {
      const existing = await AsyncStorage.getItem(liftingResultsKey);
      if (existing) {
        return;
      }
    }

    await writeStoredLiftingResults(liftingResultsKey, liftingResults);
    
    // Update store metadata
    const store = await getStore();
    if (!store.meets[meetId]) {
      const scheduleKey = `${SCHEDULE_KEY_PREFIX}${meetId}`;
      const athletesKey = `${ATHLETES_KEY_PREFIX}${meetId}`;
      store.meets[meetId] = {
        schedule: null,
        scheduleKey,
        athletesKey,
        athletes: [],
        liftingResultsKey,
        lastSyncTime: Date.now()
      };
    } else {
      store.meets[meetId].liftingResultsKey = liftingResultsKey;
      store.meets[meetId].lastSyncTime = Date.now();
    }
    try {
      await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (metadataError) {
      console.warn('Saved lifting results payload but failed to update store metadata:', metadataError);
    }
  } catch (error) {
    console.error('Error saving meet lifting results:', error);
    throw error;
  }
}

/**
 * Read the storage key listing once for a batch of `clearMeetData` calls.
 *
 * `clearMeetData` has to enumerate every AsyncStorage key to find the meet's
 * `SESSION_ATHLETES_KEY_PREFIX` entries, because the session numbers and
 * platforms that make up those keys are not recorded anywhere else. Every
 * caller that clears more than one meet paid for that listing once per meet,
 * and the listing is not small: a device with a downloaded meet holds 1500 to
 * 4500 athlete-history keys on its own (see `clearAllAthleteHistory`), and
 * "Delete all offline data" walks every meet in the upcoming window — 20 of
 * them today. One `getAllKeys` answers all 20 questions.
 *
 * Returns an empty listing for an empty batch so a sweep that finds nothing to
 * clear — `clearExpiredDownloadedMeets` runs on every meets refresh — still
 * costs nothing.
 */
export async function readStorageKeysForMeetClear(
  meetCount: number,
): Promise<readonly string[]> {
  if (meetCount <= 0) return [];
  return AsyncStorage.getAllKeys();
}

/**
 * The normalized athlete name an athlete-history or athlete-bests key belongs
 * to, or null for any other key. Chunk keys are `<manifest key>__chunk_...`,
 * so one prefix strip covers manifests, chunks and legacy raw payloads.
 */
function athleteNameOfStorageKey(key: string): string | null {
  const prefix = key.startsWith(ATHLETE_HISTORY_KEY_PREFIX)
    ? ATHLETE_HISTORY_KEY_PREFIX
    : key.startsWith(ATHLETE_BESTS_KEY_PREFIX)
      ? ATHLETE_BESTS_KEY_PREFIX
      : null;
  if (!prefix) return null;
  const rest = key.slice(prefix.length);
  const chunkAt = rest.indexOf('__chunk_');
  return chunkAt === -1 ? rest : rest.slice(0, chunkAt);
}

/**
 * Normalized names of every athlete with a history blob (or a chunk of one)
 * in a key listing. Reading the listing answers "is any history on disk for
 * these athletes" without a `multiGet`.
 */
function athleteNamesWithHistoryInListing(storageKeys: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const key of storageKeys) {
    if (!key.startsWith(ATHLETE_HISTORY_KEY_PREFIX)) continue;
    const name = athleteNameOfStorageKey(key);
    if (name) names.add(name);
  }
  return names;
}

/**
 * Removes every history, chunk and bests key of the given athletes, taken from
 * a key listing so no manifest has to be read, in bounded `multiRemove`
 * batches. Keys already gone (a batch clear shares one listing) are a no-op.
 */
async function removeAthleteKeysFromListing(
  storageKeys: readonly string[],
  normalizedNames: ReadonlySet<string>,
): Promise<number> {
  if (normalizedNames.size === 0) return 0;
  const keys = storageKeys.filter((key) => {
    const name = athleteNameOfStorageKey(key);
    return name !== null && normalizedNames.has(name);
  });
  await multiRemoveBatched(keys);
  return keys.length;
}

/**
 * Normalized names across every stored roster except `exceptMeet`'s, read one
 * roster at a time (sequential on purpose: a roster is ~0.5 MB of JSON for a
 * national meet). Cleared meets keep an empty entry and cost one null read.
 */
async function readRemainingRosterNames(
  store: OfflineStore,
  exceptMeet: string,
): Promise<Set<string>> {
  const names = new Set<string>();
  for (const [meetId, entry] of Object.entries(store.meets)) {
    if (meetId === exceptMeet) continue;
    const roster = await readStoredAthletes(entry.athletesKey, []);
    for (const athlete of roster) {
      const normalized = normalizeAthleteName(athlete.name);
      if (normalized) names.add(normalized);
    }
  }
  return names;
}

/**
 * Drops the history of the athletes on `rosterNames` that appear on no other
 * stored roster, once a meet's data is being cleared. Athlete history is
 * keyed by name, not by meet, so nothing else ever reclaimed it: a season of
 * downloaded meets left every athlete's history behind after the meet
 * expired, and the Android AsyncStorage database (6 MB by default, raised by
 * `config/withAsyncStorageDbSize`) filled with rows no screen could reach.
 *
 * Cheap exit first: a browsed-but-never-downloaded meet has a roster and no
 * history, and must not pay for reading every other roster.
 */
async function pruneAthleteHistoryExclusiveToRoster(
  meet: string,
  rosterNames: readonly string[],
  store: OfflineStore,
  storageKeys: readonly string[],
): Promise<number> {
  const withHistory = athleteNamesWithHistoryInListing(storageKeys);
  const candidates = new Set<string>();
  for (const name of rosterNames) {
    const normalized = normalizeAthleteName(name);
    if (normalized && withHistory.has(normalized)) candidates.add(normalized);
  }
  if (candidates.size === 0) return 0;

  const shared = await readRemainingRosterNames(store, meet);
  const exclusive = new Set<string>();
  for (const name of candidates) {
    if (!shared.has(name)) exclusive.add(name);
  }
  return removeAthleteKeysFromListing(storageKeys, exclusive);
}

/**
 * Removes the history and bests of every athlete on no stored roster.
 *
 * The `SQLITE_FULL` recovery in `meet-manager` used to free only the implicit
 * browse cache, which is small; the history left behind by meets cleared
 * before per-meet pruning existed is what actually fills the database, and
 * without this the retry failed the same way until "Delete all offline data".
 * `keepNames` are athletes about to be (re)written by the caller, whose
 * roster may not be on disk yet.
 *
 * @returns how many keys were removed.
 */
export async function pruneOrphanedAthleteHistory(
  options?: { keepNames?: readonly string[] },
): Promise<number> {
  try {
    const storageKeys = await AsyncStorage.getAllKeys();
    const withHistory = athleteNamesWithHistoryInListing(storageKeys);
    if (withHistory.size === 0) return 0;

    const store = await getStore();
    const keep = await readRemainingRosterNames(store, '');
    for (const name of options?.keepNames ?? []) {
      const normalized = normalizeAthleteName(name);
      if (normalized) keep.add(normalized);
    }
    const orphaned = new Set<string>();
    for (const name of withHistory) {
      if (!keep.has(name)) orphaned.add(name);
    }
    return await removeAthleteKeysFromListing(storageKeys, orphaned);
  } catch (error) {
    console.error('Error pruning orphaned athlete history:', error);
    return 0;
  }
}

// Clear meet data from store
export async function clearMeetData(
  meet: MeetName,
  options?: {
    storageKeys?: readonly string[];
    /**
     * Whether to drop the history of athletes found on no other stored
     * roster (the default). `clearAllMeetData` passes false: its callers
     * clear every athlete's history right after, and reading every remaining
     * roster once per meet would be quadratic work for nothing.
     */
    pruneHistory?: boolean;
  },
): Promise<void> {
  try {
    // `getStore()` is the one validated reader: a raw
    // `JSON.parse(store) as OfflineStore` here threw on `data.meets[...]` for a
    // truncated payload, leaving the meet's keys orphaned and undeletable.
    const data = await getStore();
    const scheduleKey = data.meets[meet]?.scheduleKey;
    const athletesKey = data.meets[meet]?.athletesKey || `${ATHLETES_KEY_PREFIX}${meet}`;
    const liftingResultsKey = data.meets[meet]?.liftingResultsKey;
    // The roster is what says whose history this meet was holding; read it
    // before it goes.
    const rosterNames =
      options?.pruneHistory === false
        ? []
        : (await readStoredAthletes(athletesKey, [])).map((athlete) => athlete.name);
    if (scheduleKey) {
      await AsyncStorage.removeItem(scheduleKey);
    }
    await AsyncStorage.removeItem(athletesKey);
    if (liftingResultsKey) {
      await clearStoredLiftingResultsValue(liftingResultsKey);
    }
    // A caller clearing several meets hands over one shared listing. Meet
    // keys are namespaced by meet id, so a snapshot taken before the batch
    // holds exactly the same keys for this meet as a fresh listing would:
    // no other iteration touches them.
    const keys = options?.storageKeys ?? (await AsyncStorage.getAllKeys());
    const sessionAthleteKeys = keys.filter((key) =>
      key.startsWith(
        `${SESSION_ATHLETES_KEY_PREFIX}${encodeURIComponent(meet)}:`,
      ),
    );
    if (sessionAthleteKeys.length > 0) {
      await AsyncStorage.multiRemove(sessionAthleteKeys);
    }
    if (rosterNames.length > 0) {
      await pruneAthleteHistoryExclusiveToRoster(meet, rosterNames, data, keys);
    }
    const emptyMeetData: MeetData = {
      schedule: null,
      scheduleKey: `${SCHEDULE_KEY_PREFIX}${meet}`,
      athletesKey: `${ATHLETES_KEY_PREFIX}${meet}`,
      athletes: [],
      liftingResultsKey: `${LIFTING_RESULTS_KEY_PREFIX}${meet}`,
      lastSyncTime: 0
    };
    data.meets[meet] = emptyMeetData;
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(data));
    await markMeetExplicitlyDownloaded(meet, false);
  } catch (error) {
    console.error('Error clearing meet data:', error);
  }
}

export async function clearAllMeetData(): Promise<void> {
  try {
    const store = await getStore();
    const meetIds = Object.keys(store.meets) as MeetName[];
    const storageKeys = await readStorageKeysForMeetClear(meetIds.length);

    for (const meetId of meetIds) {
      await clearMeetData(meetId, { storageKeys, pruneHistory: false });
    }
  } catch (error) {
    console.error('Error clearing all meet data:', error);
  }
}

export async function clearAllAthleteHistory(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    // Chunk keys are `<manifest key>__chunk_<n>`, so the prefix already covers
    // manifests, chunks, and legacy raw payloads alike. Reading each manifest
    // to rediscover its own chunk keys cost one `getItem` + one `multiRemove`
    // per athlete — 1500-4500 serial round trips on "Delete all offline data"
    // (PoT #2 bounded loops). One `getAllKeys` plus batched removes replaces
    // them, and it also reaps chunks orphaned by an interrupted write.
    const athleteHistoryKeys = keys.filter((k) =>
      k.startsWith(ATHLETE_HISTORY_KEY_PREFIX),
    );
    for (
      let offset = 0;
      offset < athleteHistoryKeys.length;
      offset += STORAGE_REMOVE_BATCH_SIZE
    ) {
      await AsyncStorage.multiRemove(
        athleteHistoryKeys.slice(offset, offset + STORAGE_REMOVE_BATCH_SIZE),
      );
    }
    // The package validators vouched for history that is now gone. Left in
    // place, the next prefetch's `304` would short-circuit with the roster
    // still on disk and never re-download a single athlete.
    await AsyncStorage.removeItem(PACKAGE_ETAG_STORAGE_KEY);
  } catch (error) {
    console.error('Error clearing athlete history:', error);
  }
}

export async function clearImplicitMeetData(exceptMeet?: MeetName): Promise<void> {
  try {
    const data = await getStore();
    const meetIds = Object.keys(data.meets);
    // One read of the downloads blob for the whole sweep instead of one per
    // meet.
    const explicitlyDownloaded = await getExplicitlyDownloadedMeetIds();
    const implicitMeetIds = meetIds.filter((meetId) => {
      const meetName = meetId as MeetName;
      if (exceptMeet && meetName === exceptMeet) return false;
      return !explicitlyDownloaded.has(meetName);
    });
    const storageKeys = await readStorageKeysForMeetClear(
      implicitMeetIds.length,
    );

    for (const meetId of implicitMeetIds) {
      await clearMeetData(meetId as MeetName, { storageKeys });
    }
  } catch (error) {
    console.error('Error clearing implicit meet data:', error);
  }
}

// Get last sync time for meet
export async function getLastSyncTime(meet: MeetName): Promise<number | null> {
  try {
    const data = await getStore();
    return data.meets[meet]?.lastSyncTime || null;
  } catch (error) {
    console.error('Error getting last sync time:', error);
    return null;
  }
}

/**
 * One meet's store entry, or null when the persisted value is not one.
 *
 * The keys are what every reader dereferences; a missing one is rebuilt from
 * the meet id, the same defaults `getMeetData` uses for a brand-new meet. The
 * inline `athletes` array is legacy (rosters live under `athletesKey` now) and
 * is kept only when it is actually an array.
 */
function toStoredMeetData(meetId: string, value: unknown): MeetData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  const stringOr = (candidate: unknown, fallback: string) =>
    typeof candidate === 'string' && candidate.length > 0 ? candidate : fallback;
  return {
    schedule: null,
    scheduleKey: stringOr(entry.scheduleKey, `${SCHEDULE_KEY_PREFIX}${meetId}`),
    athletesKey: stringOr(entry.athletesKey, `${ATHLETES_KEY_PREFIX}${meetId}`),
    athletes: Array.isArray(entry.athletes) ? (entry.athletes as LiftResult[]) : [],
    liftingResultsKey: stringOr(
      entry.liftingResultsKey,
      `${LIFTING_RESULTS_KEY_PREFIX}${meetId}`,
    ),
    lastSyncTime:
      typeof entry.lastSyncTime === 'number' && Number.isFinite(entry.lastSyncTime)
        ? entry.lastSyncTime
        : 0,
    athletesSyncedAt:
      typeof entry.athletesSyncedAt === 'number' && Number.isFinite(entry.athletesSyncedAt)
        ? entry.athletesSyncedAt
        : 0,
  };
}

function toOfflineStore(value: unknown): OfflineStore | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const meetsValue = (value as { meets?: unknown }).meets;
  if (!meetsValue || typeof meetsValue !== 'object' || Array.isArray(meetsValue)) {
    return null;
  }
  const meets: OfflineStore['meets'] = {};
  let dropped = 0;
  for (const [meetId, entry] of Object.entries(meetsValue as Record<string, unknown>)) {
    const meetData = toStoredMeetData(meetId, entry);
    if (meetData) {
      meets[meetId] = meetData;
    } else {
      dropped += 1;
    }
  }
  if (dropped > 0) {
    console.warn(`Dropped ${dropped} malformed offline store meet entries`);
  }
  return { meets };
}

async function getStore(): Promise<OfflineStore> {
  const store = await AsyncStorage.getItem(STORE_KEY);
  if (store) {
    try {
      const parsed: unknown = JSON.parse(store);
      const validated = toOfflineStore(parsed);
      if (validated) {
        return validated;
      }
    } catch (error) {
      console.warn('Store payload was invalid, reinitializing:', error);
    }
  }

  const initialStore: OfflineStore = {
    meets: {},
  };
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(initialStore));
  return initialStore;
} 
