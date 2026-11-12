import { MeetName } from '@/data/types/meet';
import { isSnapshotFresh } from '@/lib/athletes';
import { clearImplicitMeetData } from '@/lib/database/meet-data-clears';
import { isMeetExplicitlyDownloaded } from '@/lib/database/meet-downloads-registry';
import { getMeetAthletesSyncedAt, getMeetAthletesTag } from '@/lib/database/offline-store-index';
import { pruneOrphanedAthleteHistory } from '@/lib/database/athlete-history-clears';
import { markMeetAthletesCurrent, saveMeetAthletes, saveMeetSchedule } from '@/lib/database/meet-data-saves';
import { isNetworkAvailable } from '@/lib/networkUtils';
import { fetchApiMeetPackageConditional } from '@/lib/api/meet-package-api';
import { mapApiAthletes } from '@/lib/api/api-athlete-mappers';
import { fetchRosterTagged, fetchSchedule } from './queries';
import { ATTEMPT_HISTORY_YEARS, getHistoryCutoffDate } from '@/utils/dateTime';
import { devLog } from '@/lib/logger';
import { savePackageEtag } from './package-etags';
import { captureClearEpoch, isClearRunning, waitForClears, wasClearedSince } from './offline-clears';
import { PrefetchCancelledError, cancelCheckFor, criticalPrefetchRequests, fullPrefetchRequests, isMeetBeingOpened, type CancelCheck, type FullPrefetchRequest } from './prefetch-requests';
import { cleanupOldMeetData, touchMeetAccess } from './meet-cache-eviction';
import { fetchPackageForPrefetch, ingestMeetPackage, uniqueAthleteNames } from './meet-package-ingest';
import { planAthleteHistory, runAthleteHistory, type HistoryPass } from './athlete-history-download';

const FULL_PREFETCH_DELAY_MS = 5000;

export const ROSTER_PREFETCH_AFTER_FIRST_SCREEN_MS = 300;

export const ROSTER_PREFETCH_MAX_DEFER_MS = 3000;

const rosterExpediters = new Map<MeetName, () => void>();

function rosterTurn(after: Promise<unknown>): { ready: Promise<void>; expedite: () => void } {
  let released = false;
  let afterTimer: ReturnType<typeof setTimeout> | null = null;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = () => {
      if (released) return;
      released = true;
      clearTimeout(capTimer);
      if (afterTimer !== null) clearTimeout(afterTimer);
      resolve();
    };
  });
  const capTimer = setTimeout(release, ROSTER_PREFETCH_MAX_DEFER_MS);
  const settle = () => {
    if (released) return;
    afterTimer = setTimeout(release, ROSTER_PREFETCH_AFTER_FIRST_SCREEN_MS);
  };
  after.then(settle, settle);
  return { ready, expedite: release };
}

export type WarmMeetOptions = {
  rosterAfter?: Promise<unknown>;
};

export type PrefetchMeetOptions = {
  forceHistoryRefresh?: boolean;
};

export async function prefetchMeetData(
  meet: MeetName,
  options: PrefetchMeetOptions = {},
): Promise<void> {
  let waitedForOne = false;
  for (;;) {
    if (isClearRunning(meet)) {
      await waitForClears(meet);
      continue;
    }
    const inFlight = fullPrefetchRequests.get(meet);
    if (!inFlight) break;
    const superseded = wasClearedSince(meet, inFlight.startedAt);
    if (!superseded && (!options.forceHistoryRefresh || waitedForOne)) return inFlight.promise;
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

async function prefetchMeetDataUncached(
  meet: MeetName,
  options: PrefetchMeetOptions,
  throwIfCancelled: CancelCheck,
) {
  const errors: string[] = [];
  await touchMeetAccess(meet);
  const historyCutoffDate = getHistoryCutoffDate(ATTEMPT_HISTORY_YEARS);
  let etagUpdate: string | null | undefined;
  let rosterNames: string[] | null = null;
  let packageChanged = false;
  let changedNames: string[] | null = null;

  try {
    const fetched = await fetchPackageForPrefetch(meet, historyCutoffDate);
    throwIfCancelled();
    if (fetched.status === 'not_modified') {
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
      etagUpdate = null;
      try {
        await clearImplicitMeetData(meet, { skip: isMeetBeingOpened });
        throwIfCancelled();
        const refetched = await fetchApiMeetPackageConditional(meet, historyCutoffDate, null);
        if (refetched.status !== 'fresh') {
          throw new Error(`Unexpected 304 for ${meet} without a validator`);
        }
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

export async function prefetchCriticalMeetData(meet: MeetName, options: WarmMeetOptions = {}) {
  const inFlight = criticalPrefetchRequests.get(meet);
  if (inFlight) {
    if (!options.rosterAfter) rosterExpediters.get(meet)?.();
    return inFlight;
  }

  const turn = options.rosterAfter ? rosterTurn(options.rosterAfter) : null;
  if (turn) rosterExpediters.set(meet, turn.expedite);

  const request = (async () => {
    const hasNetwork = await isNetworkAvailable();
    if (!hasNetwork) return;

    const scheduleRequest = fetchSchedule(meet).then(async (schedule) => {
      if (schedule.length > 0) {
        await saveMeetSchedule(meet, schedule);
      }
      return schedule;
    });

    const startedAt = captureClearEpoch();
    const syncRosterUnlessCleared = async () => {
      const answer = await fetchRosterTagged(meet, await getMeetAthletesTag(meet));
      if (wasClearedSince(meet, startedAt)) return;
      if (answer.status === 'unchanged') await markMeetAthletesCurrent(meet);
      else await saveMeetAthletes(meet, answer.value, answer.tag);
    };
    const rosterStoredWhileDeferred = async () =>
      isSnapshotFresh(await getMeetAthletesSyncedAt(meet), Date.now()) || wasClearedSince(meet, startedAt);
    const athletesRequest = turn
      ? turn.ready.then(async () => {
          if (await rosterStoredWhileDeferred()) return;
          await syncRosterUnlessCleared();
        })
      : syncRosterUnlessCleared();

    const [scheduleResult, athletesResult] = await Promise.allSettled([
      scheduleRequest,
      athletesRequest,
    ]);

    if (scheduleResult.status === 'rejected' && athletesResult.status === 'rejected') {
      throw new Error(`Critical meet prefetch failed for ${meet}`);
    }

    await touchMeetAccess(meet);
    await cleanupOldMeetData();
  })().finally(() => {
    criticalPrefetchRequests.delete(meet);
    if (turn) {
      turn.expedite();
      if (rosterExpediters.get(meet) === turn.expedite) rosterExpediters.delete(meet);
    }
  });

  criticalPrefetchRequests.set(meet, request);
  return request;
}

export function warmMeetData(meet: MeetName, options: WarmMeetOptions = {}): Promise<void> {
  return prefetchCriticalMeetData(meet, options).then(async () => {
    const isDownloaded = await isMeetExplicitlyDownloaded(meet);
    if (!isDownloaded) return;

    const prefetchUnlessClearedMeanwhile = async () => {
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
    };
    setTimeout(() => void prefetchUnlessClearedMeanwhile(), FULL_PREFETCH_DELAY_MS);
  });
}
