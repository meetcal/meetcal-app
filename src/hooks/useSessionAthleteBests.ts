import type { AthleteBests, LiftResult } from "@/data/types/athletes";
import type { MeetName } from "@/data/types/meet";
import { getAthleteBestsBatch, getCachedAthleteBestsBatch } from "@/lib/athlete-bests";
import { devInfo } from "@/lib/logger";
import { useEffect, useRef, useState } from "react";

type SessionKey = { meetId: MeetName; sessionNumber: number; platform: string };

export function useSessionAthletesReadyLog(
  { meetId, sessionNumber, platform }: SessionKey,
  isLoading: boolean,
  athleteCount: number,
): void {
  const loadStartedAtRef = useRef(performance.now());
  const loggedLoadRef = useRef(false);

  useEffect(() => {
    loadStartedAtRef.current = performance.now();
    loggedLoadRef.current = false;
  }, [meetId, platform, sessionNumber]);

  useEffect(() => {
    if (!__DEV__ || loggedLoadRef.current || isLoading) {
      return;
    }
    if (athleteCount === 0) {
      return;
    }

    loggedLoadRef.current = true;
    const elapsedMs = Math.round(performance.now() - loadStartedAtRef.current);
    devInfo("[perf] session athletes ready", {
      elapsedMs,
      meetId,
      sessionNumber,
      platform,
      athleteCount,
    });
  }, [isLoading, meetId, platform, athleteCount, sessionNumber]);
}

export function useSessionAthleteBests(
  { meetId, sessionNumber, platform }: SessionKey,
  sessionAthletes: LiftResult[],
  isSubscribed: boolean,
): Record<string, AthleteBests> {
  const [athleteBests, setAthleteBests] = useState<Record<string, AthleteBests>>({});
  const bestsLoadStartedAtRef = useRef(performance.now());
  const loggedBestsLoadRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function loadBests() {
      if (!isSubscribed) {
        setAthleteBests({});
        return;
      }

      const athleteNames = sessionAthletes.map((athlete) => athlete.name);

      if (athleteNames.length === 0) {
        setAthleteBests({});
        return;
      }

      try {
        bestsLoadStartedAtRef.current = performance.now();
        loggedBestsLoadRef.current = false;

        const cachedBestsMap = await getCachedAthleteBestsBatch(athleteNames);
        if (cancelled) return;

        setAthleteBests(cachedBestsMap);

        if (__DEV__ && !loggedBestsLoadRef.current) {
          loggedBestsLoadRef.current = true;
          devInfo("[perf] session bests cache ready", {
            elapsedMs: Math.round(performance.now() - bestsLoadStartedAtRef.current),
            meetId,
            sessionNumber,
            platform,
            athleteCount: athleteNames.length,
          });
        }

        const bestsMap = await getAthleteBestsBatch(athleteNames, meetId);
        if (cancelled) return;
        setAthleteBests(bestsMap);

        if (__DEV__) {
          devInfo("[perf] session bests ready", {
            elapsedMs: Math.round(performance.now() - bestsLoadStartedAtRef.current),
            meetId,
            sessionNumber,
            platform,
            athleteCount: athleteNames.length,
          });
        }
      } catch (error) {
        if (cancelled) return;
        console.error("Error loading athlete bests:", error);
        setAthleteBests({});
      }
    }

    void loadBests();

    return () => {
      cancelled = true;
    };
  }, [isSubscribed, meetId, platform, sessionAthletes, sessionNumber]);

  return athleteBests;
}
