import { useCallback, useEffect, useRef, useState } from "react";

import { showToast } from "@/components/ui/Toast";
import type { LiftResult } from "@/data/types/athletes";
import { isMeetName, type MeetName } from "@/data/types/meet";
import {
  getMeetData,
  saveMeetAthletes,
  saveMeetSchedule,
} from "@/lib/database/offline-store";
import { fetchAthletesWithSession, fetchSchedule } from "@/lib/database/queries";
import { useRetryOnReconnect } from "@/hooks/useRetryOnReconnect";
import { emptyLoadFailure, type LoadFailure } from "@/lib/load-failure";
import { devInfo } from "@/lib/logger";
import { isNetworkAvailable } from "@/lib/networkUtils";
import type { Schedule } from "@/types/schedule";

/**
 * A cached roster + schedule written within this window is served as-is on
 * the initial (non pull-to-refresh) load. Selecting a meet already runs
 * `prefetchCriticalMeetData`, which fetches and saves exactly these two
 * payloads; this tab then mounted and fetched both again, so a single meet
 * open cost two roster downloads. The check uses the roster's own write
 * time (`MeetData.athletesSyncedAt`): `lastSyncTime` is also bumped by every
 * 5-minute schedule sync, which would make a days-old roster look fresh.
 * Well inside the 5-minute SyncManager cadence, so nothing goes staler than
 * it already could.
 */
export const FRESH_SNAPSHOT_TTL_MS = 60 * 1000;

export function isSnapshotFresh(athletesSyncedAt: number, now: number): boolean {
  return athletesSyncedAt > 0 && now - athletesSyncedAt < FRESH_SNAPSHOT_TTL_MS;
}

const REFRESH_FAILED_MESSAGE = "Failed to refresh start list data. Please try again.";

async function loadMeetSnapshot(meet: MeetName) {
  // `getMeetData` returns both halves of this snapshot. Asking for the
  // schedule separately ran a second `getMeetData` inside `getMeetSchedule`,
  // which re-read and re-parsed the meet's entire athlete roster — 457KB /
  // 1562 athletes for a live national meet — to produce a schedule this call
  // already had in hand. Both readers swallow their own errors into the same
  // empty values, so collapsing them changes nothing but the work.
  const cachedMeetData = await getMeetData(meet).catch(() => null);
  return {
    cachedAthletes: cachedMeetData?.athletes ?? [],
    cachedSchedule: cachedMeetData?.schedule ?? [],
    athletesSyncedAt: cachedMeetData?.athletesSyncedAt ?? 0,
  };
}

/**
 * The selected meet's roster and schedule for the Start List: the offline
 * copy first, then the network unless that copy was just written.
 *
 * Moved out of the screen unchanged. It is deliberately not a
 * `useMutableResource`: that hook always revalidates after painting the
 * cache, which would bring back the double roster download on meet open
 * that the fresh-snapshot check above exists to avoid, and it deep-compares
 * every revalidated payload (`stableSerialize` of a 1,500-athlete roster).
 * `loadFailure` says why the roster is empty when that is not "unpublished"
 * (offline with nothing cached, or the roster request failed); while it is
 * set, the load is retried when the connection comes back.
 */
export function useStartListData(selectedMeet: string | null) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [athletes, setAthletes] = useState<LiftResult[]>([]);
  const [schedule, setSchedule] = useState<Schedule>([]);
  const [loadFailure, setLoadFailure] = useState<LoadFailure | null>(null);
  const latestLoadIdRef = useRef(0);
  const loadStartedAtRef = useRef(performance.now());
  const loggedReadyRef = useRef(false);

  const load = useCallback(
    async (forceRefresh = false) => {
      if (!selectedMeet || !isMeetName(selectedMeet)) {
        setAthletes([]);
        setSchedule([]);
        setLoadFailure(null);
        setLoading(false);
        return;
      }

      const validMeet = selectedMeet;
      // Each call supersedes the one before it. Deduplicating by "something is
      // already in flight" instead would make a pull-to-refresh during the
      // initial load a silent no-op, and would leave the previous meet's
      // athletes on screen after a meet switch.
      const requestId = ++latestLoadIdRef.current;
      const isStale = () => requestId !== latestLoadIdRef.current;
      if (!forceRefresh) {
        loadStartedAtRef.current = performance.now();
        loggedReadyRef.current = false;
        // A failure belongs to the load (and meet) that hit it.
        setLoadFailure(null);
        setLoading(true);
      }

      const snapshot = await loadMeetSnapshot(validMeet);
      if (isStale()) return;

      if (!forceRefresh) {
        setAthletes(snapshot.cachedAthletes);
        setSchedule(snapshot.cachedSchedule);
        if (snapshot.cachedAthletes.length > 0) setLoadFailure(null);
        setLoading(false);
        // Both halves present and just written (by the meet-open prefetch
        // or a previous visit): the network round trip would return the
        // same bytes. Pull-to-refresh (`forceRefresh`) always goes out.
        if (
          snapshot.cachedAthletes.length > 0 &&
          snapshot.cachedSchedule.length > 0 &&
          isSnapshotFresh(snapshot.athletesSyncedAt, Date.now())
        ) {
          return;
        }
      }

      const hasNetwork = await isNetworkAvailable();
      if (isStale()) return;
      if (!hasNetwork) {
        setLoadFailure(
          emptyLoadFailure({
            shownCount: snapshot.cachedAthletes.length,
            hasNetwork,
            requestFailed: false,
          }),
        );
        setLoading(false);
        if (forceRefresh) {
          showToast({ type: "error", message: REFRESH_FAILED_MESSAGE });
          setAthletes(snapshot.cachedAthletes);
          setSchedule(snapshot.cachedSchedule);
        }
        return;
      }

      const [athletesResult, scheduleResult] = await Promise.allSettled([
        fetchAthletesWithSession(validMeet),
        fetchSchedule(validMeet),
      ]);

      if (isStale()) return;

      let nextAthletes = snapshot.cachedAthletes;
      let nextSchedule = snapshot.cachedSchedule;

      // An empty answer does not replace the saved roster on screen either;
      // `saveMeetAthletes` already refuses to store it over one.
      if (
        athletesResult.status === "fulfilled" &&
        (athletesResult.value.length > 0 || snapshot.cachedAthletes.length === 0)
      ) {
        nextAthletes = athletesResult.value;
        saveMeetAthletes(validMeet, nextAthletes).catch(() => {});
      }

      if (scheduleResult.status === "fulfilled") {
        nextSchedule = scheduleResult.value;
        if (nextSchedule.length > 0) {
          saveMeetSchedule(validMeet, nextSchedule).catch(() => {});
        }
      }

      if (
        athletesResult.status === "rejected" &&
        scheduleResult.status === "rejected" &&
        forceRefresh
      ) {
        showToast({ type: "error", message: REFRESH_FAILED_MESSAGE });
      }

      setAthletes(nextAthletes);
      setSchedule(nextSchedule);
      setLoadFailure(
        emptyLoadFailure({
          shownCount: nextAthletes.length,
          hasNetwork,
          requestFailed: athletesResult.status === "rejected",
        }),
      );
      // Unconditional: a forced refresh can supersede an initial load that
      // set `loading` and then bailed out as stale.
      setLoading(false);
    },
    [selectedMeet],
  );

  useEffect(() => {
    void load(false);
    return () => {
      // `isStale()` already supersedes an older load when a newer one starts,
      // but nothing bumped the ref on unmount, so a tab switch mid-fetch still
      // repainted a gone screen. Matches `attempt-estimator`.
      latestLoadIdRef.current += 1;
    };
  }, [load]);

  // A failed load used to stay on the empty state until a pull-to-refresh.
  useRetryOnReconnect(loadFailure !== null, () => {
    void load(false);
  });

  useEffect(() => {
    if (!__DEV__ || loggedReadyRef.current || loading || athletes.length === 0) {
      return;
    }

    loggedReadyRef.current = true;
    devInfo("[perf] start list ready", {
      elapsedMs: Math.round(performance.now() - loadStartedAtRef.current),
      meet: selectedMeet,
      athleteCount: athletes.length,
      scheduleDays: schedule.length,
    });
  }, [athletes.length, loading, schedule.length, selectedMeet]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  return { athletes, schedule, loading, refreshing, refresh, loadFailure };
}
