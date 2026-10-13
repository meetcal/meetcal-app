import AsyncStorage from '@react-native-async-storage/async-storage';
import { MeetName, Meet } from '@/data/types/meet';
import type { SupabaseBests, SupabaseLiftResult } from '@/data/types/athletes';
import { normalizeAthleteName } from '@/lib/athletes';
import {
  clearImplicitMeetData,
  clearMeetData,
  findAthleteNamesWithoutHistory,
  getExplicitlyDownloadedMeetIds,
  getMeetData,
  getMeetLiftingResults,
  isMeetExplicitlyDownloaded,
  pruneOrphanedAthleteHistory,
  saveAthleteBestsBatch,
  saveAthleteHistoryBatch,
  saveMeetAthletes,
  saveMeetLiftingResults,
  saveMeetSchedule,
} from './offline-store';
import { isNetworkAvailable } from '@/lib/networkUtils';
import { CONVEX_TRANSIENT_MESSAGE } from '@/lib/api/transport';
import {
  type ApiMeetPackage,
  fetchApiMeetByName,
  fetchApiMeetPackageConditional,
  fetchApiMeets,
  fetchApiResultsByNames,
  mapApiAthletes,
  mapApiLiftingResult,
  mapPackageSchedule,
  MeetCalApiError,
  MeetCalApiTimeoutError,
  NAMES_QUERY_CHUNK_SIZE,
} from '@/lib/api/meetcal-api';
import { fetchAthletesWithSession, fetchSchedule } from './queries';
import {
  getCachedMeetByName,
  getCachedMeets,
  MEETS_LIST_CACHE_KEY,
  setCachedMeets,
} from './meets-list-cache';
import { ATTEMPT_HISTORY_YEARS, getHistoryCutoffDate } from '@/utils/dateTime';
import { devLog } from '../logger';
import { createWriteChain } from '@/lib/data/write-chain';
import { stableSerialize } from '@/lib/data/mutable-resource';
import {
  clearPackageEtag,
  getStoredPackageEtag,
  readPackageEtags,
  savePackageEtag,
} from './package-etags';
import {
  captureClearEpoch,
  isClearRunning,
  registerInFlightPrefetchSettler,
  waitForClears,
  wasClearedSince,
  type ClearEpoch,
} from './offline-clears';

// Re-exported: callers have always read the meets list cache and the package
// ETags from here.
export { getCachedMeetByName, getCachedMeets };
export { clearPackageEtag, getStoredPackageEtag, savePackageEtag };

const MAX_CACHED_MEETS = 3;
const MEET_CACHE_KEY = '@meet_cache_info';
const TIMEOUT_LOG_THROTTLE_MS = 30000;

let inFlightFetchMeets: Promise<Meet[]> | null = null;
let warnedEmptyMeetsList = false;
let lastFetchMeetsTimeoutLogAt = 0;
const criticalPrefetchRequests = new Map<MeetName, Promise<void>>();
/** A running full prefetch, and the clear epoch it started in. */
type FullPrefetchRequest = { promise: Promise<void>; startedAt: ClearEpoch };
const fullPrefetchRequests = new Map<MeetName, FullPrefetchRequest>();

/**
 * A full prefetch stopped because the meet's data (or all athlete history)
 * was cleared after it started: Remove, Delete All, Clear Cache or expiry.
 * Nothing it would still have written belongs on disk any more.
 */
export class PrefetchCancelledError extends Error {
  constructor(meet: MeetName) {
    super(`Offline prefetch cancelled by a clear (${meet})`);
    this.name = 'PrefetchCancelledError';
  }
}

/** Throws `PrefetchCancelledError` once a clear has superseded the prefetch. */
type CancelCheck = () => void;

function cancelCheckFor(meet: MeetName, startedAt: ClearEpoch): CancelCheck {
  return () => {
    if (wasClearedSince(meet, startedAt)) throw new PrefetchCancelledError(meet);
  };
}

// A clear waits here for the prefetches it superseded, which stop at their
// next check (between requests), so nothing they write lands after it.
registerInFlightPrefetchSettler(async (meet) => {
  const requests =
    meet === null
      ? Array.from(fullPrefetchRequests.values())
      : [fullPrefetchRequests.get(meet as MeetName)];
  // Bounded by the downloads running at once (one per Offline Data row).
  await Promise.all(requests.map((request) => request?.promise.catch(() => undefined)));
});
// Downloaded meets cache the FULL competition history for every athlete on the
// start list. We fetch that history in sequential batches (rather than one
// roster-wide payload) and persist one batch at a time, keeping peak memory
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
/**
 * Seven days. A full history refresh re-fetches the whole roster: a national
 * meet is ~1,500 names, which at `HISTORY_DOWNLOAD_BATCH_SIZE` (40) per
 * request is 38 `results:byNames` calls, almost all of them re-downloading
 * history that has not changed (the store skips the write when the bytes
 * match, but the requests are still made over venue Wi-Fi).
 *
 * A changed package does not start a full refresh when an earlier copy of it
 * was ingested here: its tag hashes the whole text, which changes with every
 * result posted and as the year-bests window moves each day, so it changed on
 * nearly every open of a live meet. Only athletes whose results or year bests
 * in the package differ from the stored copy are fetched then
 * (`namesWithChangedPackageData`); everyone else waits for this TTL, the
 * missing-history check, or "Refresh All", which forces the whole roster.
 */
export const HISTORY_REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A `429`/`503` on a history batch is retried once after the server's
 * `Retry-After`, capped here so a hostile or mistaken header cannot park the
 * download, and never looped: a second failure marks the history incomplete
 * and the next prefetch fills the gap.
 */
export const HISTORY_RETRY_AFTER_MAX_MS = 5000;
/** Wait when the response carried no usable `Retry-After`. */
export const HISTORY_RETRY_AFTER_DEFAULT_MS = 1000;
const HISTORY_RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 503]);

/**
 * Convex's own "busy, try again" failures (overload, rate limits), its
 * equivalent of the Rust API's 429/503. They arrive as plain errors with no
 * status, so they are told apart by message; a function's own errors and a
 * dropped network do not match and are not retried.
 */
function isConvexTransientError(error: unknown): boolean {
  return (
    error instanceof Error &&
    !(error instanceof MeetCalApiError) &&
    !(error instanceof MeetCalApiTimeoutError) &&
    CONVEX_TRANSIENT_MESSAGE.test(error.message)
  );
}

/**
 * How long a history batch should wait before its single retry, or null when
 * the failure is not a rate-limit/unavailable response. The API client does
 * not surface headers yet, so the seconds are read from an optional
 * `retryAfterSeconds` on the error (number or the raw header string) and the
 * default applies when it is absent or unparseable.
 */
export function historyRetryDelayMs(error: unknown): number | null {
  if (isConvexTransientError(error)) return HISTORY_RETRY_AFTER_DEFAULT_MS;
  if (!(error instanceof MeetCalApiError) || !HISTORY_RETRYABLE_STATUSES.has(error.status)) {
    return null;
  }
  const raw = (error as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  const seconds =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw)
        : NaN;
  if (!Number.isFinite(seconds) || seconds < 0) return HISTORY_RETRY_AFTER_DEFAULT_MS;
  return Math.min(seconds * 1000, HISTORY_RETRY_AFTER_MAX_MS);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A history batch that failed on the network (a timeout, a dropped
 * connection) gets one more attempt after the rest of the pass, this long
 * after it. On venue Wi-Fi one timeout among a national meet's ~38 batches
 * was likely, and it failed the whole download.
 */
export const HISTORY_DEFERRED_RETRY_DELAY_MS = 1000;

/**
 * The athletes a meet's last full history refresh did not reach, per meet,
 * and when that refresh started. Kept apart from the package ETag (which now
 * only says "this package was decomposed here"), so a retry fetches these
 * names instead of the whole roster again.
 */
const HISTORY_PENDING_KEY = '@meet_history_pending_v1';

/**
 * `full`: whether finishing the names completes a full refresh (and so
 * stamps the sync time), or only a changed package's athletes. Entries
 * written before the flag existed were all full refreshes.
 */
type PendingHistory = { names: string[]; since: number; full?: boolean };

/**
 * Both per-meet history blobs (`HISTORY_SYNCED_AT_KEY`, `HISTORY_PENDING_KEY`)
 * are read-modify-written by every prefetch, and prefetches of different
 * meets run concurrently, so their writes are serialized.
 */
const historyStateWrites = createWriteChain();

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

/**
 * Stamps at least `HISTORY_REFRESH_TTL_MS` old read exactly like a missing one
 * (the history counts as stale either way), so they are dropped on every
 * write. Without this the map gained one entry per meet ever downloaded and
 * never lost any.
 */
export function pruneHistorySyncedAt(
  stamps: Record<string, number>,
  now: number,
): Record<string, number> {
  const kept: Record<string, number> = {};
  for (const [meet, syncedAt] of Object.entries(stamps)) {
    if (now - syncedAt < HISTORY_REFRESH_TTL_MS) kept[meet] = syncedAt;
  }
  return kept;
}

async function markHistorySynced(meet: MeetName): Promise<void> {
  try {
    await historyStateWrites(async () => {
      const now = Date.now();
      const stamps = pruneHistorySyncedAt(await readHistorySyncedAt(), now);
      stamps[meet] = now;
      await AsyncStorage.setItem(HISTORY_SYNCED_AT_KEY, JSON.stringify(stamps));
    });
  } catch (error) {
    console.warn('Could not record athlete history sync time:', error);
  }
}

async function readPendingHistory(): Promise<Record<string, PendingHistory>> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_PENDING_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, PendingHistory> = {};
    for (const [meet, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const entry = value as { names?: unknown; since?: unknown };
      if (!Array.isArray(entry.names)) continue;
      if (typeof entry.since !== 'number' || !Number.isFinite(entry.since)) continue;
      const names = entry.names.filter(
        (name): name is string => typeof name === 'string' && name.length > 0,
      );
      out[meet] = { names, since: entry.since, full: (entry as { full?: unknown }).full !== false };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Pending entries whose refresh started at least `HISTORY_REFRESH_TTL_MS`
 * ago are dropped: by then the next refresh covers the whole roster anyway.
 */
export function prunePendingHistory(
  pending: Record<string, PendingHistory>,
  now: number,
): Record<string, PendingHistory> {
  const kept: Record<string, PendingHistory> = {};
  for (const [meet, entry] of Object.entries(pending)) {
    if (now - entry.since < HISTORY_REFRESH_TTL_MS) kept[meet] = entry;
  }
  return kept;
}

/**
 * Records (or with `null`, clears) the athletes a meet's refresh still owes.
 *
 * @returns whether the write landed (logged, not thrown, when it did not).
 */
async function writePendingHistory(meet: MeetName, entry: PendingHistory | null): Promise<boolean> {
  try {
    await historyStateWrites(async () => {
      const current = await readPendingHistory();
      if (entry === null && !current[meet]) return;
      const next = prunePendingHistory(current, Date.now());
      if (entry === null) delete next[meet];
      // `full` is written only when false: absent reads as a full refresh.
      else next[meet] = { names: entry.names, since: entry.since, ...(entry.full === false ? { full: false } : {}) };
      await AsyncStorage.setItem(HISTORY_PENDING_KEY, JSON.stringify(next));
    });
    return true;
  } catch (error) {
    console.warn('Could not record pending athlete history:', error);
    return false;
  }
}

/**
 * Adds `names` to what a meet's history still owes, keeping an existing
 * entry's start and kind, or starting a changed-package entry
 * (`full: false`). Written before a changed package's results are saved over
 * the stored copy: once they are, the comparison that found these names
 * finds nothing, so an app killed before the history pass would never fetch
 * them.
 *
 * @returns whether the write landed.
 */
async function addPendingHistoryNames(meet: MeetName, names: readonly string[]): Promise<boolean> {
  if (names.length === 0) return true;
  try {
    await historyStateWrites(async () => {
      const now = Date.now();
      const next = prunePendingHistory(await readPendingHistory(), now);
      const current = next[meet];
      const merged = Array.from(new Set([...(current?.names ?? []), ...names]));
      const full = current ? current.full !== false : false;
      next[meet] = { names: merged, since: current?.since ?? now, ...(full ? {} : { full: false }) };
      await AsyncStorage.setItem(HISTORY_PENDING_KEY, JSON.stringify(next));
    });
    return true;
  } catch (error) {
    console.warn('Could not record pending athlete history:', error);
    return false;
  }
}

/**
 * Which athletes a history pass downloads.
 *
 * - `force` (Refresh All), or a package that is new here (`packageChanged`
 *   without `changedNames`: a first download, or a re-ingest after a clear):
 *   the whole roster.
 * - An unfinished pass younger than the TTL: the athletes it did not reach,
 *   plus any with no history blob at all, plus a changed package's changed
 *   athletes. This is the resume: one failed batch used to make the next
 *   attempt start over from batch one. A changed package's partial pass
 *   (`full: false`) resumes only while the last full sync is fresh.
 * - A last full sync older than the TTL: the roster.
 * - A changed package (`changedNames`): those athletes and the gaps, tracked
 *   as pending so a failed one is retried, without stamping a full sync.
 * - Otherwise only the gaps (athletes with no blob on disk).
 *
 * `fullRefresh` says whether finishing the pass completes a full refresh
 * (and so stamps the sync time); `since` is when that refresh started;
 * `track` whether what the pass owes is recorded as pending until done.
 * `findMissing` (the storage probe for athletes with no blob) only runs on
 * the paths that use it.
 */
export async function planHistoryDownload(input: {
  rosterNames: readonly string[];
  findMissing: (names: readonly string[]) => Promise<string[]>;
  pending: PendingHistory | undefined;
  syncedAt: number;
  packageChanged: boolean;
  /** For a changed package ingested here before: whose data in it changed. */
  changedNames?: readonly string[] | null;
  force: boolean;
  now: number;
}): Promise<{ names: string[]; fullRefresh: boolean; since: number; track: boolean }> {
  const { rosterNames, pending, now } = input;
  const changedNames = input.packageChanged ? input.changedNames ?? null : null;
  const wholeRoster = { names: [...rosterNames], fullRefresh: true, since: now, track: true };
  if (input.force || (input.packageChanged && changedNames === null)) return wholeRoster;

  // Names are matched to today's roster by normalized name; an athlete since
  // withdrawn is dropped.
  const rosterByName = new Map(rosterNames.map((name) => [normalizeAthleteName(name), name]));
  const addOnRoster = (into: Set<string>, names: readonly string[]) => {
    for (const name of names) {
      const onRoster = rosterByName.get(normalizeAthleteName(name));
      if (onRoster) into.add(onRoster);
    }
  };

  const fullSyncDue = now - input.syncedAt >= HISTORY_REFRESH_TTL_MS;
  // A changed package's partial pass never completes a full refresh, so it
  // gives way to one that is due; an unfinished full refresh resumes.
  if (
    pending &&
    now - pending.since < HISTORY_REFRESH_TTL_MS &&
    (pending.full !== false || !fullSyncDue)
  ) {
    const names = new Set<string>();
    addOnRoster(names, pending.names);
    addOnRoster(names, changedNames ?? []);
    for (const name of await input.findMissing(rosterNames)) names.add(name);
    return { names: Array.from(names), fullRefresh: pending.full !== false, since: pending.since, track: true };
  }
  if (fullSyncDue) return wholeRoster;
  if (changedNames !== null) {
    const names = new Set<string>();
    addOnRoster(names, changedNames);
    for (const name of await input.findMissing(rosterNames)) names.add(name);
    return { names: Array.from(names), fullRefresh: false, since: now, track: true };
  }
  return { names: await input.findMissing(rosterNames), fullRefresh: false, since: now, track: false };
}

type PackageBests = { snatch_best: number | null; cj_best: number | null; total: number | null };

/**
 * The athletes (normalized names) whose data in a changed package differs
 * from the stored copy: their rows in the meet's results differ, or they
 * have a real year best that differs from the stored one. Their history may
 * have changed; nobody else's did because of this package. A best that only
 * left the moving window (no best in the package now) says nothing new about
 * history, so it does not count.
 */
export function namesWithChangedPackageData(input: {
  results: readonly SupabaseLiftResult[];
  storedResults: readonly SupabaseLiftResult[];
  yearBests: Readonly<Record<string, PackageBests>>;
  storedBests: Readonly<Record<string, { bests: SupabaseBests }>>;
}): Set<string> {
  const rowsByName = (rows: readonly SupabaseLiftResult[]) => {
    const byName = new Map<string, string[]>();
    for (const row of rows) {
      const name = normalizeAthleteName(row.name);
      if (!name) continue;
      const list = byName.get(name) ?? [];
      list.push(stableSerialize(row));
      byName.set(name, list);
    }
    const joined = new Map<string, string>();
    for (const [name, list] of byName) joined.set(name, list.sort().join('\n'));
    return joined;
  };
  const fresh = rowsByName(input.results);
  const stored = rowsByName(input.storedResults);
  const changed = new Set<string>();
  for (const [name, rows] of fresh) if (stored.get(name) !== rows) changed.add(name);
  for (const name of stored.keys()) if (!fresh.has(name)) changed.add(name);

  const storedBestsByName = new Map<string, SupabaseBests>();
  for (const [name, entry] of Object.entries(input.storedBests)) {
    storedBestsByName.set(normalizeAthleteName(name), entry.bests);
  }
  for (const [name, bests] of Object.entries(input.yearBests)) {
    const normalized = normalizeAthleteName(name);
    if (!normalized) continue;
    const before = storedBestsByName.get(normalized);
    if (
      !before ||
      before.snatch_best !== bests.snatch_best ||
      before.cj_best !== bests.cj_best ||
      before.total !== bests.total
    ) {
      changed.add(normalized);
    }
  }
  return changed;
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

export async function clearCachedMeetsList(): Promise<void> {
  try {
    // On the cache-info chain, so an access stamp already queued does not
    // land after the removal and bring the old blob back.
    await cacheInfoWrites(() => AsyncStorage.multiRemove([MEETS_LIST_CACHE_KEY, MEET_CACHE_KEY]));
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

/**
 * Every read-modify-write of `@meet_cache_info` runs on this chain. The
 * eviction sweep used to read the blob, clear meets (slow) and write its old
 * copy back, so a meet opened during the sweep lost its access stamp and
 * dropped out of LRU accounting for good: never evicted.
 */
const cacheInfoWrites = createWriteChain();

/** Applies `mutate` to the current cache info and saves it; logs a failed write. */
async function updateCacheInfo(mutate: (info: CacheInfo) => void): Promise<void> {
  try {
    await cacheInfoWrites(async () => {
      const info = await getCacheInfo();
      mutate(info);
      await AsyncStorage.setItem(MEET_CACHE_KEY, JSON.stringify(info));
    });
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
      // A valid `200 []` (a deploy window, an empty upstream table) used to
      // overwrite the only offline copy of the meets list; the next offline
      // cold start then had no meet, no time zone and empty tabs while the
      // roster and history were still on disk. Keep the cache; the caller
      // still sees the empty answer.
      if (meets.length === 0 && (await getCachedMeets()).length > 0) {
        if (!warnedEmptyMeetsList) {
          warnedEmptyMeetsList = true;
          devLog('/meets answered with no meets; keeping the cached list');
        }
        return meets;
      }
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
  | {
      status: 'fresh';
      etag: string | null;
      package: ApiMeetPackage;
      /** Whether it replaces a copy of the package ingested here (a validator was sent). */
      replacesIngested: boolean;
    }
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
    return { ...fetched, replacesIngested: storedEtag !== null };
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
  return { ...refetched, replacesIngested: false };
}

export async function touchMeetAccess(meet: MeetName) {
  await updateCacheInfo((info) => {
    // `size` used to be recomputed here by `JSON.stringify`-ing the whole
    // roster on every access. Nothing reads it for eviction (that is count
    // based), so it is carried forward rather than measured.
    info.meets[meet] = {
      lastAccessed: Date.now(),
      size: info.meets[meet]?.size ?? 0,
    };
  });
}

// Evict implicitly-cached meets beyond the most-recently-accessed MAX_CACHED_MEETS.
//
// Meets the user explicitly downloaded for offline use are always kept — they were
// retained on purpose and are pruned only when their end date passes
// (clearExpiredDownloadedMeets) or when the user deletes them. Everything else is
// transient browse cache; without this bound it accumulates until the AsyncStorage
// SQLite store hits SQLITE_FULL.
/** A meet whose open (critical prefetch) or download is in flight. */
export function isMeetBeingOpened(meet: MeetName): boolean {
  return criticalPrefetchRequests.has(meet) || fullPrefetchRequests.has(meet);
}

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
  // Each evicted meet with the access stamp it was evicted under.
  const evicted: { meet: MeetName; lastAccessed: number }[] = [];
  for (const [meet, snapshot] of meets) {
    if (explicitlyDownloaded.has(meet)) {
      continue;
    }
    // A meet is marked downloaded only once its prefetch resolves, and its
    // last access used to be stamped at the same point, so opening three
    // other meets during a long history download evicted it mid-way.
    if (fullPrefetchRequests.has(meet)) {
      continue;
    }
    implicitKept += 1;
    if (implicitKept <= MAX_CACHED_MEETS) {
      continue;
    }
    // Clearing a meet is slow, and the sweep's snapshot ages meanwhile. A
    // meet opened since it was taken is the most recent one now, not a
    // candidate.
    const latest = (await getCacheInfo()).meets[meet];
    if (latest && latest.lastAccessed !== snapshot.lastAccessed) {
      continue;
    }
    // Being opened right now: its access is stamped only once the open's
    // saves are done, so the stamp check above cannot see it yet.
    if (isMeetBeingOpened(meet)) {
      continue;
    }
    // The validator goes first, so a download that starts during the clear
    // fetches the package in full rather than trusting a `304` for data the
    // clear is removing (an ETag dropped for a meet that is then skipped
    // only costs one full fetch).
    await clearPackageEtag(meet);
    // Checked again: an open that started during that write would queue its
    // saves ahead of the clear. From here `clearMeetData` only waits a
    // microtask (no download of this meet is running) before it joins the
    // meet's chain, while an open's first save follows a network round trip;
    // a save that starts later waits for the clear (they share one chain), so
    // a meet reopened meanwhile keeps what it saves.
    if (isMeetBeingOpened(meet)) {
      continue;
    }
    await clearMeetData(meet);
    evicted.push({ meet, lastAccessed: snapshot.lastAccessed });
  }

  if (evicted.length === 0) return;
  // Only the evicted entries are removed, from the blob as it is now:
  // writing back the snapshot dropped every access stamped during the sweep.
  // A meet stamped again while it was being cleared was reopened; its new
  // stamp (and the data its open saved after the clear) stays.
  await updateCacheInfo((info) => {
    for (const { meet, lastAccessed } of evicted) {
      const current = info.meets[meet];
      if (current && current.lastAccessed !== lastAccessed) continue;
      delete info.meets[meet];
    }
  });
}

export type PrefetchMeetOptions = {
  /**
   * Re-download every athlete's history even when the package answers `304`
   * and the history is younger than `HISTORY_REFRESH_TTL_MS`. A user-initiated
   * "Refresh All" means *now*; the package ETag does not cover history.
   */
  forceHistoryRefresh?: boolean;
};

// Prefetch meet data. Writes over the stored copy in place and never clears
// it first, so a failed prefetch leaves whatever was already on disk.
//
// Never joins a prefetch that started before the meet was last cleared: that
// one stops without restoring what the clear removed, and a Download (or
// Clear Cache's re-sync) that joined it used to mark the meet downloaded with
// nothing on disk. It is waited out and a new one runs.
export async function prefetchMeetData(
  meet: MeetName,
  options: PrefetchMeetOptions = {},
): Promise<void> {
  // Checked again after every wait, with no await between the last check and
  // the new request's registration below.
  let waitedForOne = false;
  for (;;) {
    // A clear of this meet still running would delete what this download
    // reads (its ETag, its roster) after it read them; start once it is done.
    // A clear can also start while this waits for a superseded request.
    if (isClearRunning(meet)) {
      await waitForClears(meet);
      continue;
    }
    const inFlight = fullPrefetchRequests.get(meet);
    if (!inFlight) break;
    const superseded = wasClearedSince(meet, inFlight.startedAt);
    if (!superseded && (!options.forceHistoryRefresh || waitedForOne)) return inFlight.promise;
    // A background warm-up may not refresh history; let it finish (its
    // outcome is not this caller's) and then run the forced one.
    await inFlight.promise.catch(() => undefined);
    waitedForOne = true;
  }

  const startedAt = captureClearEpoch();
  const entry: FullPrefetchRequest = {
    startedAt,
    promise: prefetchMeetDataUncached(meet, options, cancelCheckFor(meet, startedAt)).finally(
      () => {
        if (fullPrefetchRequests.get(meet) === entry) fullPrefetchRequests.delete(meet);
      },
    ),
  };
  fullPrefetchRequests.set(meet, entry);
  return entry.promise;
}

/**
 * Persists each athlete's FULL competition history so the athlete results
 * screen shows complete history offline. We deliberately do NOT use the
 * package's recent_results_by_name (a capped recent window kept for attempt
 * estimates / bests) — instead we pull full history from /lifting-results
 * /by-names in sequential batches, grouping the rows by athlete and writing
 * the batch's athletes in one storage batch. Sequential batches + per-batch
 * pako writes keep peak memory bounded; the bulk roster history never sits in
 * memory at once, which is what previously let the iOS watchdog kill the
 * download.
 *
 * A batch whose request failed on the network (timeout, dropped connection)
 * is tried once more after the rest of the pass, still one batch at a time.
 * Rate limits already had their one `Retry-After` wait in `fetchHistoryBatch`,
 * and a function's own error or a failed write would fail the same way again.
 *
 * Fetch *and* persist failures are recorded here rather than thrown: the
 * caller's SQLITE_FULL handler only knows how to redo the package ingest, and
 * a storage-full error during these larger full-history writes would otherwise
 * let prefetch resolve "successfully" and silently mark the meet downloaded
 * with partial/missing athlete history.
 *
 * @returns the athletes whose history was not written (empty when complete).
 */
async function downloadAthleteHistory(
  meet: MeetName,
  athleteNames: readonly string[],
  throwIfCancelled: CancelCheck,
): Promise<string[]> {
  const failed: string[] = [];
  const deferred: string[][] = [];
  for (let i = 0; i < athleteNames.length; i += HISTORY_DOWNLOAD_BATCH_SIZE) {
    const batch = athleteNames.slice(i, i + HISTORY_DOWNLOAD_BATCH_SIZE);
    const outcome = await downloadHistoryBatch(meet, batch, throwIfCancelled);
    if (outcome === 'network') deferred.push(batch);
    else if (outcome === 'failed') failed.push(...batch);
  }
  if (deferred.length > 0) {
    await wait(HISTORY_DEFERRED_RETRY_DELAY_MS);
    for (const batch of deferred) {
      if ((await downloadHistoryBatch(meet, batch, throwIfCancelled)) !== 'saved') {
        failed.push(...batch);
      }
    }
  }
  return failed;
}

/**
 * Fetches and stores one batch. `network` is a request that never got an
 * answer (worth one more try later); `failed` is anything else.
 */
async function downloadHistoryBatch(
  meet: MeetName,
  batch: readonly string[],
  throwIfCancelled: CancelCheck,
): Promise<'saved' | 'network' | 'failed'> {
  // Checked before the request and again before the write: a clear landing
  // in between must not get this batch written after it.
  throwIfCancelled();
  let batchResults: SupabaseLiftResult[];
  try {
    batchResults = await fetchHistoryBatch(batch);
  } catch (historyError) {
    logHistoryBatchFailure(meet, batch, historyError);
    return isNetworkFailure(historyError) ? 'network' : 'failed';
  }

  throwIfCancelled();
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

  try {
    // One storage batch per network batch: one `multiSet`, one read-back,
    // one `multiRemove`, and no write at all for athletes whose history
    // has not changed since the last download.
    await saveAthleteHistoryBatch(
      batch.map((name) => ({
        name,
        results: resultsByName.get(normalizeAthleteName(name)) ?? [],
      })),
    );
    return 'saved';
  } catch (historyError) {
    logHistoryBatchFailure(meet, batch, historyError);
    return 'failed';
  }
}

function logHistoryBatchFailure(meet: MeetName, batch: readonly string[], error: unknown): void {
  // Count, not names: athlete names stay out of logs and crash reports.
  console.error('Prefetch athlete history batch failed:', {
    meet,
    batchSize: batch.length,
    error,
  });
}

/**
 * A request that failed without the server answering: a timeout or a dropped
 * connection. A `MeetCalApiError` is an answer, and Convex's "busy" errors
 * were already retried after their wait.
 */
function isNetworkFailure(error: unknown): boolean {
  if (error instanceof MeetCalApiTimeoutError) return true;
  return !(error instanceof MeetCalApiError) && !isConvexTransientError(error);
}

/** One `/by-names` batch, retried once after `Retry-After` on a 429/503, or after a Convex overload. */
async function fetchHistoryBatch(batch: readonly string[]): Promise<SupabaseLiftResult[]> {
  const names = Array.from(batch);
  try {
    return await fetchApiResultsByNames(names);
  } catch (error) {
    const delayMs = historyRetryDelayMs(error);
    if (delayMs === null) throw error;
    await wait(delayMs);
    return fetchApiResultsByNames(names);
  }
}

/** A planned history pass (see `planHistoryDownload`), ready to run. */
interface HistoryPass {
  names: string[];
  fullRefresh: boolean;
  since: number;
  /** Whether what the pass owes is kept as pending until it is fetched. */
  track: boolean;
  /** Whether an unfinished refresh was on disk when the pass was planned. */
  hadPending: boolean;
  /**
   * Whether what the pass owes is on disk: true unless a full refresh's
   * pending list could not be written. A package ETag must not be saved over
   * an unrecorded refresh: the next `304` would then plan only the gaps.
   */
  recorded: boolean;
}

/**
 * Plans a meet's history pass for `rosterNames` and, for a full refresh,
 * records its names as pending before anything is fetched, so an app killed
 * at any point after this resumes with them rather than with nothing owed.
 */
async function planAthleteHistory(
  meet: MeetName,
  rosterNames: readonly string[],
  options: { packageChanged: boolean; changedNames?: readonly string[] | null; force: boolean },
): Promise<HistoryPass> {
  const [syncedAtByMeet, pendingByMeet] = await Promise.all([
    readHistorySyncedAt(),
    readPendingHistory(),
  ]);
  const plan = await planHistoryDownload({
    rosterNames,
    findMissing: findAthleteNamesWithoutHistory,
    pending: pendingByMeet[meet],
    syncedAt: syncedAtByMeet[meet] ?? 0,
    packageChanged: options.packageChanged,
    changedNames: options.changedNames,
    force: options.force,
    now: Date.now(),
  });

  // A gap-only pass is recomputed from storage next time; a full refresh or
  // a changed package's athletes need their remainder written down.
  const recorded =
    plan.track && plan.names.length > 0
      ? await writePendingHistory(meet, {
          names: plan.names,
          since: plan.since,
          full: plan.fullRefresh,
        })
      : true;
  return { ...plan, hadPending: Boolean(pendingByMeet[meet]), recorded };
}

/**
 * Runs a planned history pass and records what is still missing, so the
 * next attempt resumes there.
 *
 * @returns true when every athlete the pass set out to fetch was written.
 */
async function runAthleteHistory(
  meet: MeetName,
  pass: HistoryPass,
  throwIfCancelled: CancelCheck,
): Promise<boolean> {
  const failed =
    pass.names.length > 0 ? await downloadAthleteHistory(meet, pass.names, throwIfCancelled) : [];
  throwIfCancelled();
  if (failed.length > 0) {
    if (pass.track) {
      await writePendingHistory(meet, { names: failed, since: pass.since, full: pass.fullRefresh });
    }
    return false;
  }
  if (pass.fullRefresh) await markHistorySynced(meet);
  if (pass.hadPending || (pass.track && pass.names.length > 0)) {
    await writePendingHistory(meet, null);
  }
  return true;
}

/**
 * Decomposes a fresh package into storage: schedule, roster (which also
 * writes the per-session caches), the meet's own results and year bests.
 * Athlete history is the caller's next step (`planAthleteHistory`).
 *
 * @returns the roster's athlete names. A schedule/roster/result write that
 * fails throws, so the caller can retry the whole ingest after a SQLITE_FULL
 * cleanup.
 */
/**
 * Each downloaded meet's package year bests as last ingested here, by
 * normalized name, as `[snatch, cj, total]` (0 for none). What a changed
 * package's bests are compared with: the shared per-athlete bests store is
 * not a snapshot of the package (a Start List lookup updates it on its own),
 * so an athlete who lifted elsewhere, looked up first, compared equal and
 * kept a history without that meet.
 */
const PACKAGE_BESTS_KEY = '@meet_package_year_bests_v1';
type BestsSnapshot = Record<string, [number, number, number]>;
const packageBestsWrites = createWriteChain();

function isBestsSnapshot(value: unknown): value is BestsSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every(
    (row) =>
      Array.isArray(row) &&
      row.length === 3 &&
      row.every((n) => typeof n === 'number' && Number.isFinite(n)),
  );
}

async function readPackageBestsSnapshots(): Promise<Record<string, BestsSnapshot>> {
  try {
    const raw = await AsyncStorage.getItem(PACKAGE_BESTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, BestsSnapshot> = {};
    for (const [meet, snapshot] of Object.entries(parsed as Record<string, unknown>)) {
      if (isBestsSnapshot(snapshot)) out[meet] = snapshot;
    }
    return out;
  } catch {
    return {};
  }
}

/** The meet's last ingested package bests, null when there is none (compare nothing). */
async function readPackageBestsSnapshot(
  meet: MeetName,
): Promise<Record<string, { bests: SupabaseBests }> | null> {
  const snapshot = (await readPackageBestsSnapshots())[meet];
  if (!snapshot) return null;
  const byName: Record<string, { bests: SupabaseBests }> = {};
  for (const [name, [snatch, cj, total]] of Object.entries(snapshot)) {
    byName[name] = {
      bests: { snatch_best: snatch || null, cj_best: cj || null, total: total || null },
    };
  }
  return byName;
}

/**
 * Records the ingested package's bests for the next comparison. Meets with no
 * stored package ETag are dropped (removed, cleared or evicted), which bounds
 * the blob by the meets downloaded. A failed write is logged: the next
 * changed package then refreshes the whole roster.
 */
async function writePackageBestsSnapshot(
  meet: MeetName,
  yearBests: Readonly<Record<string, PackageBests>>,
): Promise<void> {
  const snapshot: BestsSnapshot = {};
  for (const [name, bests] of Object.entries(yearBests)) {
    snapshot[normalizeAthleteName(name)] = [bests.snatch_best ?? 0, bests.cj_best ?? 0, bests.total ?? 0];
  }
  try {
    await packageBestsWrites(async () => {
      const [current, etags] = await Promise.all([readPackageBestsSnapshots(), readPackageEtags()]);
      const next: Record<string, BestsSnapshot> = {};
      for (const [other, value] of Object.entries(current)) {
        if (other !== meet && etags[other] !== undefined) next[other] = value;
      }
      next[meet] = snapshot;
      await AsyncStorage.setItem(PACKAGE_BESTS_KEY, JSON.stringify(next));
    });
  } catch (error) {
    console.warn('Could not record the package year bests:', error);
  }
}

async function ingestMeetPackage(
  meet: MeetName,
  pkg: ApiMeetPackage,
  options: { findChanges: boolean } = { findChanges: false },
): Promise<{ rosterNames: string[]; changedNames: string[] | null }> {
  const schedule = mapPackageSchedule(pkg);
  const athletes = mapApiAthletes(pkg.athletes, '/meets/package');
  const athleteNames = uniqueAthleteNames(athletes);
  const liftingResults = pkg.meet_results.map(mapApiLiftingResult);
  const yearBests = packageYearBests(pkg);

  // Compared before anything is written over the stored copy.
  let changedNames: string[] | null = null;
  if (options.findChanges) {
    const [storedResults, storedBests] = await Promise.all([
      getMeetLiftingResults(meet),
      readPackageBestsSnapshot(meet),
    ]);
    // With no snapshot (none recorded yet, or it was lost) there is nothing
    // to compare the bests with: the whole roster is owed.
    if (storedBests) {
      changedNames = Array.from(
        namesWithChangedPackageData({ results: liftingResults, storedResults, yearBests, storedBests }),
      );
      // Not recorded: the whole roster is owed instead (nothing can be missed).
      if (!(await addPendingHistoryNames(meet, changedNames))) changedNames = null;
    }
  }

  if (schedule.length > 0) {
    await saveMeetSchedule(meet, schedule);
  }
  const rosterSaved = await saveMeetAthletes(meet, athletes);

  if (liftingResults.length > 0) {
    validatePrefetchedLiftingResults(meet, athleteNames, liftingResults);
    await saveMeetLiftingResults(meet, liftingResults);
  }

  await saveAthleteBestsBatch(yearBests);
  await writePackageBestsSnapshot(meet, yearBests);

  // An empty roster that `saveMeetAthletes` refused to store over the
  // downloaded one: the history pass is for the roster still on disk, not
  // for nobody (which would mark the meet's history synced).
  if (!rosterSaved) return { rosterNames: (await readLocalRosterNames(meet)) ?? [], changedNames };
  return { rosterNames: athleteNames, changedNames };
}

/**
 * The package's year bests, only rows with a real best. The package answers
 * every roster name, with zeros for anyone who has not lifted inside its
 * window; stored, those read as a fresh "no results" and kept the start list
 * from ever falling back to the athlete's most recent meet.
 */
function packageYearBests(pkg: ApiMeetPackage): Record<string, PackageBests> {
  const yearBests: Record<string, PackageBests> = {};
  for (const [name, bests] of Object.entries(pkg.year_bests_by_name ?? {})) {
    const row = {
      snatch_best: bests.best_snatch > 0 ? bests.best_snatch : null,
      cj_best: bests.best_cj > 0 ? bests.best_cj : null,
      total: bests.best_total > 0 ? bests.best_total : null,
    };
    if (row.snatch_best !== null || row.cj_best !== null || row.total !== null) {
      yearBests[name] = row;
    }
  }
  return yearBests;
}

async function prefetchMeetDataUncached(
  meet: MeetName,
  options: PrefetchMeetOptions,
  throwIfCancelled: CancelCheck,
) {
  const errors: string[] = [];
  // Stamp the access up front too, so the meet is the most recent one for
  // as long as the download runs, not only once it has finished.
  await touchMeetAccess(meet);
  const historyCutoffDate = getHistoryCutoffDate(ATTEMPT_HISTORY_YEARS);
  // The package ETag is the per-meet "package ingested" marker: it is saved
  // as soon as a package is fully decomposed, before the history pass and
  // whatever happens in it, because history completeness is tracked on its
  // own (the sync stamp and the pending list). It used to be withheld when one history
  // batch failed, so the retry re-ingested the package and re-downloaded
  // every athlete. `undefined` leaves the stored one alone (a `304`, or a
  // request that never got an answer, changed nothing on disk); `null`
  // drops it (a package was being written over the stored copy).
  let etagUpdate: string | null | undefined;
  let rosterNames: string[] | null = null;
  let packageChanged = false;
  // Whose data a changed package changed; null means the whole roster's
  // history is owed (a first download, or a re-ingest after a cleanup).
  let changedNames: string[] | null = null;

  try {
    const fetched = await fetchPackageForPrefetch(meet, historyCutoffDate);
    throwIfCancelled();
    if (fetched.status === 'not_modified') {
      // The roster on disk proves the *package* was decomposed here, not that
      // every athlete's history survived: "Delete all offline data" and the
      // SQLITE_FULL cleanup remove history without touching the roster. The
      // history pass fills in whatever is missing rather than trusting the
      // validator for it.
      rosterNames = fetched.athleteNames;
    } else {
      etagUpdate = null;
      const ingested = await ingestMeetPackage(meet, fetched.package, {
        findChanges: fetched.replacesIngested,
      });
      rosterNames = ingested.rosterNames;
      changedNames = ingested.changedNames;
      etagUpdate = fetched.etag;
      packageChanged = true;
    }
  } catch (error) {
    if (error instanceof PrefetchCancelledError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('SQLITE_FULL')) {
      // Free the browse cache, then redo the *whole* ingest; the history
      // pass below runs either way. Restoring only `meet_results` here used
      // to leave the meet marked downloaded, and pinned by an ETag, with no
      // athlete history.
      etagUpdate = null;
      try {
        // Downloads still running in other rows are not browse cache yet
        // (a meet is marked downloaded only once its download finishes).
        await clearImplicitMeetData(meet, { skip: isMeetBeingOpened });
        throwIfCancelled();
        const refetched = await fetchApiMeetPackageConditional(meet, historyCutoffDate, null);
        if (refetched.status !== 'fresh') {
          throw new Error(`Unexpected 304 for ${meet} without a validator`);
        }
        // The browse cache is small; what fills the database is the history
        // of athletes on no stored roster. This meet's own athletes are kept
        // even if its roster write is what failed: their unchanged history
        // costs the retry no write at all.
        await pruneOrphanedAthleteHistory({
          keepNames: uniqueAthleteNames(mapApiAthletes(refetched.package.athletes, '/meets/package')),
        });
        rosterNames = (await ingestMeetPackage(meet, refetched.package)).rosterNames;
        changedNames = null;
        etagUpdate = refetched.etag;
        packageChanged = true;
      } catch (retryError) {
        if (retryError instanceof PrefetchCancelledError) throw retryError;
        console.error('Prefetch meet package failed after cleanup retry:', { meet, error: retryError });
        errors.push('meet_package');
      }
    } else {
      console.error('Prefetch meet package failed:', { meet, error });
      errors.push('meet_package');
    }
  }

  // What the history pass owes is planned, and written down, before the new
  // ETag is saved. Saved the other way round, an app killed in between came
  // back to a `304` with no pending list and planned only the gaps, leaving
  // every changed history stale until the TTL ran out.
  // A clear during the ingest: nothing more is written, the ETag included.
  throwIfCancelled();
  let historyPass: HistoryPass | null = null;
  if (rosterNames) {
    try {
      historyPass = await planAthleteHistory(meet, rosterNames, {
        packageChanged,
        changedNames,
        force: options.forceHistoryRefresh === true,
      });
    } catch (historyError) {
      console.error('Prefetch athlete history failed:', { meet, error: historyError });
      errors.push('athlete_history');
    }
  }

  // Saved before the history pass, which can run for minutes on a national
  // meet: an app killed during it then resumes from a `304` and the pending
  // list instead of re-ingesting the package. A changed package whose
  // history could not be recorded is treated as not ingested: dropping the
  // ETag makes the next attempt fetch it in full and refresh every history.
  if (etagUpdate !== undefined) {
    const historyRecorded = historyPass?.recorded === true;
    await savePackageEtag(meet, packageChanged && !historyRecorded ? null : etagUpdate);
  }

  if (historyPass) {
    try {
      const complete = await runAthleteHistory(meet, historyPass, throwIfCancelled);
      if (!complete) errors.push('athlete_history');
    } catch (historyError) {
      if (historyError instanceof PrefetchCancelledError) throw historyError;
      console.error('Prefetch athlete history failed:', { meet, error: historyError });
      errors.push('athlete_history');
    }
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

    const scheduleRequest = fetchSchedule(meet).then(async (schedule) => {
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

    setTimeout(async () => {
      // Asked again: a Remove, Delete All or Clear Cache in the meantime
      // turns this into a full download of a meet nobody downloaded. A clear
      // still running has not un-marked the meet yet, so it is waited out
      // first, and one that starts while the mark is read wins.
      await waitForClears(meet);
      const epoch = captureClearEpoch();
      if (!(await isMeetExplicitlyDownloaded(meet).catch(() => false))) return;
      if (wasClearedSince(meet, epoch)) return;
      prefetchMeetData(meet).catch((error) => {
        if (error instanceof PrefetchCancelledError) {
          devLog('Deferred full meet prefetch stopped by a clear', { meet });
          return;
        }
        console.error('Deferred full meet prefetch failed:', { meet, error });
      });
    }, FULL_PREFETCH_DELAY_MS);
  });
}
