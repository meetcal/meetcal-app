import AsyncStorage from '@react-native-async-storage/async-storage';
import { MeetName, Meet } from '@/data/types/meet';
import type { SupabaseLiftResult } from '@/data/types/athletes';
import { normalizeAthleteName } from '@/lib/athletes';
import {
  clearImplicitMeetData,
  clearMeetData,
  getExplicitlyDownloadedMeetIds,
  getMeetData,
  isMeetExplicitlyDownloaded,
  saveAthleteBestsBatch,
  saveAthleteHistory,
  saveMeetAthletes,
  saveMeetLiftingResults,
  saveMeetSchedule,
  saveSessionAthletes,
} from './offline-store';
import { isNetworkAvailable } from '@/lib/networkUtils';
import {
  fetchApiMeetByName,
  fetchApiMeetPackage,
  fetchApiMeets,
  fetchApiResultsByNames,
  mapApiAthletes,
  mapApiLiftingResult,
  mapPackageSchedule,
  MeetCalApiTimeoutError,
} from '@/lib/api/meetcal-api';
import { fetchAthletesWithSession, fetchSchedule } from './queries';
import type { Schedule } from '@/types/schedule';
import {
  ATTEMPT_HISTORY_YEARS,
  calculateInitialPage,
  getHistoryCutoffDate,
} from '@/utils/dateTime';
import { devLog } from '../logger';

const MAX_CACHED_MEETS = 3;
const MEET_CACHE_KEY = '@meet_cache_info';
const MEETS_LIST_CACHE_KEY = '@meets_list_cache_v1';
const TIMEOUT_LOG_THROTTLE_MS = 30000;

let inFlightFetchMeets: Promise<Meet[]> | null = null;
let lastFetchMeetsTimeoutLogAt = 0;
const criticalPrefetchRequests = new Map<MeetName, Promise<void>>();
const fullPrefetchRequests = new Map<MeetName, Promise<void>>();
const PRIORITY_SESSION_PREFETCH_LIMIT = 8;
// Downloaded meets cache the FULL competition history for every athlete on the
// start list. We fetch that history in small sequential batches (rather than one
// roster-wide payload) and persist one athlete at a time, keeping peak memory
// bounded so the iOS watchdog can't terminate the download even though the total
// history is now larger than the old 2-year window.
const HISTORY_DOWNLOAD_BATCH_SIZE = 25;

const FULL_PREFETCH_DELAY_MS = 5000;

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

// Fetch a single meet by name
export async function fetchMeetByName(name: string): Promise<Meet | null> {
  try {
    const cached = await getCachedMeets();
    const cachedMeet = cached.find(meet => meet.name === name) ?? null;
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
async function calculateMeetSize(meet: MeetName): Promise<number> {
  try {
    const data = await getMeetData(meet);
    return new Blob([JSON.stringify(data)]).size;
  } catch (error) {
    console.error('Error calculating meet size:', error);
    return 0;
  }
}

// Update meet access time and size
export async function updateMeetAccess(meet: MeetName) {
  const info = await getCacheInfo();
  const size = await calculateMeetSize(meet);
  
  // Update total size
  const currentMeetInfo = info.meets[meet];
  if (currentMeetInfo) {
    info.totalSize -= currentMeetInfo.size;
  }
  info.totalSize += size;
  
  // Update meet info
  info.meets[meet] = {
    lastAccessed: Date.now(),
    size
  };
  
  await saveCacheInfo(info);
}

export async function touchMeetAccess(meet: MeetName) {
  const info = await getCacheInfo();
  const currentMeetInfo = info.meets[meet];

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

async function prefetchMeetDataUncached(meet: MeetName) {
  const errors: string[] = [];
  const historyCutoffDate = getHistoryCutoffDate(ATTEMPT_HISTORY_YEARS);

  try {
    const pkg = await fetchApiMeetPackage(meet, historyCutoffDate);
    const schedule = mapPackageSchedule(pkg);
    const athletes = mapApiAthletes(pkg.athletes, '/meets/package');
    const athleteNames = Array.from(
      new Set(athletes.map((athlete) => athlete.name).filter(Boolean)),
    );
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

    // Persist each athlete's FULL competition history so the athlete results
    // screen shows complete history offline. We deliberately do NOT use the
    // package's recent_results_by_name (a capped recent window kept for attempt
    // estimates / bests) — instead we pull full history from /lifting-results
    // /by-names in small sequential batches, grouping the rows by athlete and
    // writing one athlete at a time. Sequential batches + per-athlete pako writes
    // keep peak memory bounded; the bulk roster history never sits in memory at
    // once, which is what previously let the iOS watchdog kill the download.
    // Fetch *and* persist failures must be recorded here rather than bubbling up
    // to the outer SQLITE_FULL handler below. That handler only restores
    // meet_results, so a storage-full error during these larger full-history
    // writes would otherwise let prefetch resolve "successfully" and silently
    // mark the meet downloaded with partial/missing athlete history.
    let historyIncomplete = false;
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
          const rows =
            resultsByName.get(normalizeAthleteName(name)) ?? [];
          await saveAthleteHistory(name, rows);
        }
      } catch (historyError) {
        console.error('Prefetch athlete history batch failed:', {
          meet,
          names: batch,
          error: historyError,
        });
        historyIncomplete = true;
      }
    }
    if (historyIncomplete) {
      errors.push('athlete_history');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('SQLITE_FULL')) {
      try {
        await clearImplicitMeetData(meet);
        const pkg = await fetchApiMeetPackage(meet, historyCutoffDate);
        const liftingResults = pkg.meet_results.map(mapApiLiftingResult);
        await saveMeetLiftingResults(meet, liftingResults);
      } catch (retryError) {
        console.error('Prefetch meet package failed after cleanup retry:', { meet, error: retryError });
        errors.push('meet_package');
      }
    } else {
      console.error('Prefetch meet package failed:', { meet, error });
      errors.push('meet_package');
    }
  }

  await updateMeetAccess(meet);
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

    const scheduleRequest = fetchSchedule(meet).then(async (schedule) => {
      if (schedule.length > 0) {
        await saveMeetSchedule(meet, schedule);
        await prefetchPrioritySessionAthletes(meet, schedule);
      }
      return schedule;
    });

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

function getPrioritySessionTargetGroups(schedule: Schedule) {
  const initialDayIndex = calculateInitialPage(schedule);
  const priorityDays = [
    ...schedule.slice(initialDayIndex),
    ...schedule.slice(0, initialDayIndex).reverse(),
  ];
  let remainingTargets = PRIORITY_SESSION_PREFETCH_LIMIT;
  const targetGroups: { sessionNumber: number; platform: string }[][] = [];

  for (const day of priorityDays) {
    if (remainingTargets <= 0) break;

    const dayTargets = day.sessions
      .flatMap((session) =>
        session.platforms.map((platform) => ({
          sessionNumber: session.number,
          platform: platform.platform,
        })),
      )
      .slice(0, remainingTargets);

    if (dayTargets.length > 0) {
      targetGroups.push(dayTargets);
      remainingTargets -= dayTargets.length;
    }
  }

  return targetGroups;
}

async function prefetchPrioritySessionAthletes(
  meet: MeetName,
  schedule: Schedule,
) {
  const targetGroups = getPrioritySessionTargetGroups(schedule);
  if (targetGroups.length === 0) return;

  for (const targets of targetGroups) {
    await Promise.allSettled(
      targets.map(async ({ sessionNumber, platform }) => {
        const athletes = await fetchAthletesWithSession(meet, sessionNumber, platform);
        await saveSessionAthletes(meet, sessionNumber, platform, athletes);
      }),
    );
  }
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
