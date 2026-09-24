import AsyncStorage from '@react-native-async-storage/async-storage';
import { MeetName, Meet } from '@/data/types/meet';
import type { SupabaseLiftResult } from '@/data/types/athletes';
import { normalizeAthleteName } from '@/lib/athletes';
import {
  clearImplicitMeetData,
  clearMeetData,
  findAthleteNamesWithoutHistory,
  getExplicitlyDownloadedMeetIds,
  getMeetData,
  isMeetExplicitlyDownloaded,
  PACKAGE_ETAG_STORAGE_KEY,
  saveAthleteBestsBatch,
  saveAthleteHistory,
  saveMeetAthletes,
  saveMeetLiftingResults,
  saveMeetSchedule,
} from './offline-store';
import { isNetworkAvailable } from '@/lib/networkUtils';
import {
  type ApiMeetPackage,
  fetchApiMeetByName,
  fetchApiMeetPackageConditional,
  fetchApiMeets,
  fetchApiResultsByNames,
  mapApiAthletes,
  mapApiLiftingResult,
  mapPackageSchedule,
  MeetCalApiTimeoutError,
  NAMES_QUERY_CHUNK_SIZE,
} from '@/lib/api/meetcal-api';
import { fetchAthletesWithSession, fetchSchedule } from './queries';
import { ATTEMPT_HISTORY_YEARS, getHistoryCutoffDate } from '@/utils/dateTime';
import { devLog } from '../logger';

const MAX_CACHED_MEETS = 3;
const MEET_CACHE_KEY = '@meet_cache_info';
// `/meets/package` ETag per meet, written only after a prefetch fully succeeds
// so a partial download can never be short-circuited by a `304`. The key is
// declared in `offline-store`, which clears it alongside the athlete history
// the validator vouches for.
const PACKAGE_ETAG_KEY = PACKAGE_ETAG_STORAGE_KEY;
const MEETS_LIST_CACHE_KEY = '@meets_list_cache_v1';
const TIMEOUT_LOG_THROTTLE_MS = 30000;

let inFlightFetchMeets: Promise<Meet[]> | null = null;
let lastFetchMeetsTimeoutLogAt = 0;
const criticalPrefetchRequests = new Map<MeetName, Promise<void>>();
const fullPrefetchRequests = new Map<MeetName, Promise<void>>();
// Downloaded meets cache the FULL competition history for every athlete on the
// start list. We fetch that history in sequential batches (rather than one
// roster-wide payload) and persist one athlete at a time, keeping peak memory
// bounded so the iOS watchdog can't terminate the download even though the total
// history is now larger than the old 2-year window. One batch is one
// `/lifting-results/by-names` request: anything larger is chunked again by the
// client anyway, and anything smaller only adds round trips.
const HISTORY_DOWNLOAD_BATCH_SIZE = NAMES_QUERY_CHUNK_SIZE;

const FULL_PREFETCH_DELAY_MS = 5000;

// When each downloaded meet's athlete history was last fetched in full. The
// package ETag only covers roster, schedule, results and year bests, so a new
// result that is not a best leaves it unchanged; on a `304` the history is
// refreshed once it is older than this instead of never.
const HISTORY_SYNCED_AT_KEY = '@meet_history_synced_at_v1';
export const HISTORY_REFRESH_TTL_MS = 24 * 60 * 60 * 1000;

async function readHistorySyncedAt(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_SYNCED_AT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [meet, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) out[meet] = value;
    }
    return out;
  } catch {
    return {};
  }
}

async function markHistorySynced(meet: MeetName): Promise<void> {
  try {
    const stamps = await readHistorySyncedAt();
    stamps[meet] = Date.now();
    await AsyncStorage.setItem(HISTORY_SYNCED_AT_KEY, JSON.stringify(stamps));
  } catch (error) {
    console.warn('Could not record athlete history sync time:', error);
  }
}

interface MeetInfo {
  lastAccessed: number;
  size: number;
}

interface CacheInfo {
  totalSize: number;
  meets: { [key: string]: MeetInfo };
}

/**
 * Guards against a lifting-results payload that belongs to a different meet.
 *
 * An *empty* result set is not an error: an upcoming meet has a full athlete
 * roster and no results at all until it is lifted. The only caller
 * (`prefetchMeetDataUncached`) therefore skips this when there is nothing to
 * check, and throwing on `liftingResults.length === 0` here would fail the
 * offline download of every upcoming meet.
 */
export function validatePrefetchedLiftingResults(
  meet: MeetName,
  athleteNames: string[],
  liftingResults: { name?: string | null }[],
): void {
  if (athleteNames.length > 0 && liftingResults.length > 0) {
    const athleteSet = new Set(athleteNames.map(normalizeAthleteName));
    const matchedCount = liftingResults.reduce((count, result) => {
      return athleteSet.has(normalizeAthleteName(result.name)) ? count + 1 : count;
    }, 0);

    if (matchedCount === 0) {
      throw new Error(`No matched lifting results fetched for meet athletes: ${meet}`);
    }
  }
}

/**
 * The cached meets list is the offline source for the meet picker, the schedule
 * header and every meet-local time conversion, so a row without `name`,
 * `dates` or `time` is not a meet we can render — it would surface as
 * `Cannot read property 'timeZoneIdentifier' of undefined` in a screen rather
 * than as a missing row here.
 */
function isCachedMeet(value: unknown): value is Meet {
  if (!value || typeof value !== 'object') return false;
  const meet = value as Partial<Meet>;
  return (
    typeof meet.name === 'string' &&
    meet.name.length > 0 &&
    typeof meet.dates === 'object' &&
    meet.dates !== null &&
    typeof meet.time === 'object' &&
    meet.time !== null &&
    typeof meet.time.timeZoneIdentifier === 'string'
  );
}

export async function getCachedMeets(): Promise<Meet[]> {
  try {
    const cached = await AsyncStorage.getItem(MEETS_LIST_CACHE_KEY);
    if (!cached) return [];
    const parsed: unknown = JSON.parse(cached);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCachedMeet);
  } catch (error) {
    console.error('Error reading cached meets list:', error);
    return [];
  }
}

async function setCachedMeets(meets: Meet[]): Promise<void> {
  try {
    await AsyncStorage.setItem(MEETS_LIST_CACHE_KEY, JSON.stringify(meets));
  } catch (error) {
    console.error('Error saving cached meets list:', error);
  }
}

export async function clearCachedMeetsList(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([MEETS_LIST_CACHE_KEY, MEET_CACHE_KEY]);
  } catch (error) {
    console.error('Error clearing cached meets list:', error);
  }
}

// Initialize or get cache info
async function getCacheInfo(): Promise<CacheInfo> {
  try {
    const info = await AsyncStorage.getItem(MEET_CACHE_KEY);
    if (info) {
      // Callers do `Object.entries(cacheInfo.meets)`. A legacy or truncated
      // entry that parses but has no `meets` object would throw there, inside
      // `cleanupOldMeetData`, failing every meet open from then on.
      const parsed: unknown = JSON.parse(info);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const candidate = parsed as Record<string, unknown>;
        if (candidate.meets && typeof candidate.meets === 'object' && !Array.isArray(candidate.meets)) {
          const meets: Record<string, MeetInfo> = {};
          let totalSize = 0;
          for (const [name, value] of Object.entries(candidate.meets)) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
            const entry = value as Record<string, unknown>;
            if (
              typeof entry.lastAccessed !== 'number' || !Number.isFinite(entry.lastAccessed) || entry.lastAccessed < 0 ||
              typeof entry.size !== 'number' || !Number.isFinite(entry.size) || entry.size < 0
            ) continue;
            // Only validated entries can participate in eviction/accounting.
            Object.defineProperty(meets, name, {
              value: { lastAccessed: entry.lastAccessed, size: entry.size },
              enumerable: true, configurable: true, writable: true,
            });
            totalSize += entry.size;
          }
          return { totalSize, meets };
        }
      }
    }
    return {
      totalSize: 0,
      meets: {}
    };
  } catch (error) {
    console.error('Error getting cache info:', error);
    return {
      totalSize: 0,
      meets: {}
    };
  }
}

// Save cache info
async function saveCacheInfo(info: CacheInfo) {
  try {
    await AsyncStorage.setItem(MEET_CACHE_KEY, JSON.stringify(info));
  } catch (error) {
    console.error('Error saving cache info:', error);
  }
}

// Fetch all active meets from the MeetCal API
export async function fetchMeetsFresh(): Promise<Meet[]> {
  if (inFlightFetchMeets) {
    return inFlightFetchMeets;
  }

  inFlightFetchMeets = (async () => {
    try {
      const hasNetwork = await isNetworkAvailable();
      if (!hasNetwork) throw new Error('Offline');

      const meets = await fetchApiMeets();
      await setCachedMeets(meets);
      return meets;
    } catch (error) {
      const isTimeout = error instanceof MeetCalApiTimeoutError;
      const now = Date.now();
      if (!isTimeout || now - lastFetchMeetsTimeoutLogAt >= TIMEOUT_LOG_THROTTLE_MS) {
        if (isTimeout) {
          lastFetchMeetsTimeoutLogAt = now;
          console.warn('fetchMeets timed out; using cached meets list');
        } else {
          console.error('Error in fetchMeets:', error);
        }
      }
      throw error;
    } finally {
      inFlightFetchMeets = null;
    }
  })();

  return inFlightFetchMeets;
}

/**
 * The meet from the cached `/meets` list only — never the network. For
 * callers that want to *skip* a `/meets/details` round trip when the answer is
 * already on disk, and can carry on without it when it is not.
 */
export async function getCachedMeetByName(name: string): Promise<Meet | null> {
  const cached = await getCachedMeets();
  return cached.find((meet) => meet.name === name) ?? null;
}

// Fetch a single meet by name
export async function fetchMeetByName(name: string): Promise<Meet | null> {
  try {
    const cachedMeet = await getCachedMeetByName(name);
    if (cachedMeet) return cachedMeet;

    const hasNetwork = await isNetworkAvailable();
    if (!hasNetwork) return null;

    const actualMeet = await fetchApiMeetByName(name);

    if (!actualMeet) {
      devLog('No meet found with name:', name);
      return null;
    }

    return actualMeet;
  } catch (error) {
    console.error('Error in fetchMeetByName:', error);
    const cached = await getCachedMeets();
    return cached.find(meet => meet.name === name) ?? null;
  }
}

// Calculate meet size
async function readPackageEtags(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(PACKAGE_ETAG_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch (error) {
    console.error('Error reading package etags:', error);
  }
  return {};
}

async function writePackageEtags(etags: Record<string, string>): Promise<void> {
  try {
    await AsyncStorage.setItem(PACKAGE_ETAG_KEY, JSON.stringify(etags));
  } catch (error) {
    console.error('Error saving package etags:', error);
  }
}

export async function getStoredPackageEtag(meet: MeetName): Promise<string | null> {
  const etags = await readPackageEtags();
  const etag = etags[meet];
  return typeof etag === 'string' && etag.length > 0 ? etag : null;
}

export async function savePackageEtag(meet: MeetName, etag: string | null): Promise<void> {
  const etags = await readPackageEtags();
  if (etag) {
    etags[meet] = etag;
  } else {
    delete etags[meet];
  }
  await writePackageEtags(etags);
}

export async function clearPackageEtag(meet: MeetName): Promise<void> {
  await savePackageEtag(meet, null);
}

// A `304` is only trustworthy while the copy it refers to is still on disk.
// Meet data is cleared from several places (eviction, SQLITE_FULL recovery,
// user deletion), so the validator is checked against local state rather than
// assumed to have been cleared alongside it.
//
// Resolves the cached roster's names, or `null` when there is no roster: the
// roster is the cheapest proof the package was decomposed here, and its names
// are what the history check below needs anyway.
async function readLocalRosterNames(meet: MeetName): Promise<string[] | null> {
  try {
    const data = await getMeetData(meet);
    const names = uniqueAthleteNames(data.athletes ?? []);
    return names.length > 0 ? names : null;
  } catch {
    return null;
  }
}

function uniqueAthleteNames(athletes: readonly { name: string }[]): string[] {
  return Array.from(new Set(athletes.map((athlete) => athlete.name).filter(Boolean)));
}

type PackageForPrefetch =
  | { status: 'fresh'; etag: string | null; package: ApiMeetPackage }
  | { status: 'not_modified'; athleteNames: string[] };

/**
 * Fetches the package for a prefetch, revalidating against the stored ETag.
 * A `not_modified` result carries the roster names already on disk, so the
 * caller can still verify every athlete's history is present.
 */
async function fetchPackageForPrefetch(
  meet: MeetName,
  historyCutoffDate: string,
): Promise<PackageForPrefetch> {
  const storedEtag = await getStoredPackageEtag(meet);
  const fetched = await fetchApiMeetPackageConditional(meet, historyCutoffDate, storedEtag);
  if (fetched.status === 'fresh') {
    return fetched;
  }
  const localNames = await readLocalRosterNames(meet);
  if (localNames) {
    return { status: 'not_modified', athleteNames: localNames };
  }
  // The validator outlived the data it described; drop it and fetch in full.
  await clearPackageEtag(meet);
  const refetched = await fetchApiMeetPackageConditional(meet, historyCutoffDate, null);
  if (refetched.status !== 'fresh') {
    throw new Error(`Unexpected 304 for ${meet} without a validator`);
  }
  return refetched;
}

export async function touchMeetAccess(meet: MeetName) {
  const info = await getCacheInfo();
  const currentMeetInfo = info.meets[meet];

  // `size` used to be recomputed here by `JSON.stringify`-ing the whole
  // roster on every access. Nothing reads it for eviction (that is count
  // based), so it is carried forward rather than measured.
  info.meets[meet] = {
    lastAccessed: Date.now(),
    size: currentMeetInfo?.size ?? 0,
  };

  await saveCacheInfo(info);
}

// Evict implicitly-cached meets beyond the most-recently-accessed MAX_CACHED_MEETS.
//
// Meets the user explicitly downloaded for offline use are always kept — they were
// retained on purpose and are pruned only when their end date passes
// (clearExpiredDownloadedMeets) or when the user deletes them. Everything else is
// transient browse cache; without this bound it accumulates until the AsyncStorage
// SQLite store hits SQLITE_FULL.
async function cleanupOldMeetData() {
  const info = await getCacheInfo();
  const meets = Object.entries(info.meets) as [MeetName, MeetInfo][];

  // Most-recently-accessed first so the active meet is never a candidate.
  meets.sort(([, a], [, b]) => b.lastAccessed - a.lastAccessed);

  // One read of the downloads blob for the whole sweep: this runs on every
  // meet open, and the per-meet `isMeetExplicitlyDownloaded` call re-read and
  // re-parsed the same AsyncStorage value once per cached meet.
  const explicitlyDownloaded = await getExplicitlyDownloadedMeetIds();

  let implicitKept = 0;
  for (const [meet] of meets) {
    if (explicitlyDownloaded.has(meet)) {
      continue;
    }
    implicitKept += 1;
    if (implicitKept <= MAX_CACHED_MEETS) {
      continue;
    }
    await clearMeetData(meet);
    await clearPackageEtag(meet);
    delete info.meets[meet];
  }

  await saveCacheInfo(info);
}

// Prefetch meet data
export async function prefetchMeetData(meet: MeetName) {
  const inFlight = fullPrefetchRequests.get(meet);
  if (inFlight) return inFlight;

  const request = prefetchMeetDataUncached(meet).finally(() => {
    fullPrefetchRequests.delete(meet);
  });
  fullPrefetchRequests.set(meet, request);
  return request;
}

/**
 * Persists each athlete's FULL competition history so the athlete results
 * screen shows complete history offline. We deliberately do NOT use the
 * package's recent_results_by_name (a capped recent window kept for attempt
 * estimates / bests) — instead we pull full history from /lifting-results
 * /by-names in sequential batches, grouping the rows by athlete and writing
 * one athlete at a time. Sequential batches + per-athlete pako writes keep
 * peak memory bounded; the bulk roster history never sits in memory at once,
 * which is what previously let the iOS watchdog kill the download.
 *
 * Fetch *and* persist failures are recorded here rather than thrown: the
 * caller's SQLITE_FULL handler only knows how to redo the package ingest, and
 * a storage-full error during these larger full-history writes would otherwise
 * let prefetch resolve "successfully" and silently mark the meet downloaded
 * with partial/missing athlete history.
 *
 * @returns true when every athlete's history was written.
 */
async function downloadAthleteHistory(
  meet: MeetName,
  athleteNames: readonly string[],
): Promise<boolean> {
  let complete = true;
  for (let i = 0; i < athleteNames.length; i += HISTORY_DOWNLOAD_BATCH_SIZE) {
    const batch = athleteNames.slice(i, i + HISTORY_DOWNLOAD_BATCH_SIZE);
    try {
      const batchResults = await fetchApiResultsByNames(batch);

      const resultsByName = new Map<string, SupabaseLiftResult[]>();
      for (const row of batchResults) {
        const key = normalizeAthleteName(row.name);
        const existing = resultsByName.get(key);
        if (existing) {
          existing.push(row);
        } else {
          resultsByName.set(key, [row]);
        }
      }

      for (const name of batch) {
        const rows = resultsByName.get(normalizeAthleteName(name)) ?? [];
        await saveAthleteHistory(name, rows);
      }
    } catch (historyError) {
      // Count, not names: athlete names stay out of logs and crash reports.
      console.error('Prefetch athlete history batch failed:', {
        meet,
        batchSize: batch.length,
        error: historyError,
      });
      complete = false;
    }
  }
  return complete;
}

/**
 * Decomposes a fresh package into storage: schedule, roster (which also
 * writes the per-session caches), the meet's own results, year bests, then
 * every athlete's full history.
 *
 * @returns whether the history download completed. A schedule/roster/result
 * write that fails throws, so the caller can retry the whole ingest after a
 * SQLITE_FULL cleanup.
 */
async function ingestMeetPackage(
  meet: MeetName,
  pkg: ApiMeetPackage,
): Promise<{ historyComplete: boolean }> {
  const schedule = mapPackageSchedule(pkg);
  const athletes = mapApiAthletes(pkg.athletes, '/meets/package');
  const athleteNames = uniqueAthleteNames(athletes);
  const liftingResults = pkg.meet_results.map(mapApiLiftingResult);

  if (schedule.length > 0) {
    await saveMeetSchedule(meet, schedule);
  }
  await saveMeetAthletes(meet, athletes);

  if (liftingResults.length > 0) {
    validatePrefetchedLiftingResults(meet, athleteNames, liftingResults);
    await saveMeetLiftingResults(meet, liftingResults);
  }

  await saveAthleteBestsBatch(
    Object.fromEntries(
      Object.entries(pkg.year_bests_by_name ?? {}).map(([name, bests]) => [
        name,
        {
          snatch_best: bests.best_snatch > 0 ? bests.best_snatch : null,
          cj_best: bests.best_cj > 0 ? bests.best_cj : null,
          total: bests.best_total > 0 ? bests.best_total : null,
        },
      ]),
    ),
  );

  const historyComplete = await downloadAthleteHistory(meet, athleteNames);
  return { historyComplete };
}

async function prefetchMeetDataUncached(meet: MeetName) {
  const errors: string[] = [];
  const historyCutoffDate = getHistoryCutoffDate(ATTEMPT_HISTORY_YEARS);
  let freshEtag: string | null = null;
  // A `304` leaves the stored validator alone: the package it describes is
  // still byte-identical, whatever happened to the athlete history since.
  let keepStoredEtag = false;

  try {
    const fetched = await fetchPackageForPrefetch(meet, historyCutoffDate);
    if (fetched.status === 'not_modified') {
      keepStoredEtag = true;
      // The roster on disk proves the *package* was decomposed here, not that
      // every athlete's history survived: "Delete all offline data" and the
      // SQLITE_FULL cleanup remove history without touching the roster. Fill
      // in whatever is missing rather than trusting the validator for it.
      const syncedAt = (await readHistorySyncedAt())[meet] ?? 0;
      const historyIsStale = Date.now() - syncedAt >= HISTORY_REFRESH_TTL_MS;
      const toFetch = historyIsStale
        ? fetched.athleteNames
        : await findAthleteNamesWithoutHistory(fetched.athleteNames);
      if (toFetch.length > 0) {
        if (await downloadAthleteHistory(meet, toFetch)) {
          if (historyIsStale) await markHistorySynced(meet);
        } else {
          errors.push('athlete_history');
        }
      }
    } else {
      freshEtag = fetched.etag;
      const { historyComplete } = await ingestMeetPackage(meet, fetched.package);
      if (historyComplete) {
        await markHistorySynced(meet);
      } else {
        errors.push('athlete_history');
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('SQLITE_FULL')) {
      // Free the browse cache, then redo the *whole* ingest — history
      // included. Restoring only `meet_results` here used to leave the meet
      // marked downloaded, and pinned by an ETag, with no athlete history.
      keepStoredEtag = false;
      freshEtag = null;
      try {
        await clearImplicitMeetData(meet);
        const refetched = await fetchApiMeetPackageConditional(meet, historyCutoffDate, null);
        if (refetched.status !== 'fresh') {
          throw new Error(`Unexpected 304 for ${meet} without a validator`);
        }
        const { historyComplete } = await ingestMeetPackage(meet, refetched.package);
        if (historyComplete) {
          freshEtag = refetched.etag;
          await markHistorySynced(meet);
        } else {
          errors.push('athlete_history');
        }
      } catch (retryError) {
        console.error('Prefetch meet package failed after cleanup retry:', { meet, error: retryError });
        errors.push('meet_package');
      }
    } else {
      console.error('Prefetch meet package failed:', { meet, error });
      errors.push('meet_package');
    }
  }

  // Only a complete prefetch may be short-circuited next time; anything
  // partial must refetch in full.
  if (!keepStoredEtag) {
    await savePackageEtag(meet, errors.length === 0 ? freshEtag : null);
  }

  await touchMeetAccess(meet);
  await cleanupOldMeetData();

  if (errors.length > 0) {
    throw new Error(`Offline prefetch incomplete (${meet}): ${errors.join(', ')}`);
  }
}

export async function prefetchCriticalMeetData(meet: MeetName) {
  const inFlight = criticalPrefetchRequests.get(meet);
  if (inFlight) return inFlight;

  const request = (async () => {
    const hasNetwork = await isNetworkAvailable();
    if (!hasNetwork) return;

    // The meets list is already cached by the time a meet is opened, so the
    // schedule fetch can skip its `/meets/details` companion request.
    const cachedMeet = await getCachedMeetByName(meet);

    const scheduleRequest = fetchSchedule(meet, cachedMeet).then(async (schedule) => {
      if (schedule.length > 0) {
        await saveMeetSchedule(meet, schedule);
      }
      return schedule;
    });

    // One roster request. `saveMeetAthletes` also writes every per-session
    // cache from it, so the eight extra `/meets/athletes-sessions` calls that
    // used to "warm" the first visible sessions only duplicated this one.
    const athletesRequest = fetchAthletesWithSession(meet).then(async (athletes) => {
      await saveMeetAthletes(meet, athletes);
      return athletes;
    });

    const [scheduleResult, athletesResult] = await Promise.allSettled([
      scheduleRequest,
      athletesRequest,
    ]);

    if (scheduleResult.status === 'rejected' && athletesResult.status === 'rejected') {
      throw new Error(`Critical meet prefetch failed for ${meet}`);
    }

    await touchMeetAccess(meet);
    // Runs on every meet open, so this is where the browse cache is bounded back
    // to MAX_CACHED_MEETS and stale implicit meets are evicted before they pile up.
    await cleanupOldMeetData();
  })().finally(() => {
    criticalPrefetchRequests.delete(meet);
  });

  criticalPrefetchRequests.set(meet, request);
  return request;
}

export function warmMeetData(meet: MeetName): Promise<void> {
  return prefetchCriticalMeetData(meet).then(async () => {
    // The full meet package bundles ~2 years of lifting history for every athlete
    // in the meet. Ingesting it (decode + per-athlete pako compression + storage
    // writes) is memory-heavy, and running it automatically on every meet open is
    // what lets the iOS watchdog terminate the app. Only auto-refresh it for meets
    // the user explicitly downloaded for offline use; everyone else fetches the
    // history they need on demand.
    const isDownloaded = await isMeetExplicitlyDownloaded(meet);
    if (!isDownloaded) return;

    setTimeout(() => {
      prefetchMeetData(meet).catch((error) => {
        console.error('Deferred full meet prefetch failed:', { meet, error });
      });
    }, FULL_PREFETCH_DELAY_MS);
  });
}
