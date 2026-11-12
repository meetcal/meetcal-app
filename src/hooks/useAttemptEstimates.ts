import type { AthleteMeetResult, LiftResult } from "@/data/types/athletes";
import type { MeetName } from "@/data/types/meet";
import { filterSessionAthletes, freshRosterReplacesShown } from "@/lib/athletes";
import { type AthleteAttemptEstimate, calculateEstimates } from "@/lib/attempt-estimator";
import type { EstimatesLoadIssue } from "@/lib/attempt-estimator-copy";
import {
  getAllCachedLiftingResultsForAthletes,
  getSessionAthletesFromMeetCache,
  saveSessionAthletes,
} from "@/lib/database/offline-store";
import {
  fetchAthletesWithSession,
  fetchRecentAthleteHistoryForNames,
} from "@/lib/database/queries";
import { isNetworkAvailable } from "@/lib/networkUtils";
import { ATTEMPT_HISTORY_YEARS, getHistoryCutoffDate } from "@/utils/dateTime";
import { useCallback, useEffect, useRef, useState } from "react";

export type AttemptEstimatesSession = {
  meet: string;
  sessionNumber: number;
  platform: string;
  hasValidParams: boolean;
};

export type AttemptEstimatesState = {
  estimates: AthleteAttemptEstimate[];
  loading: boolean;
  refreshing: boolean;
  loadIssue: EstimatesLoadIssue;
  reload: () => Promise<void>;
};

async function readCachedSessionResults(
  cachedSessionAthletes: LiftResult[],
  cutoffDate: string,
): Promise<AthleteMeetResult[]> {
  const namedAthletes = cachedSessionAthletes.filter((athlete) => athlete.name?.trim());
  const resultsByName = await getAllCachedLiftingResultsForAthletes(
    namedAthletes.map((athlete) => athlete.name),
  );
  const cachedSessionResults: AthleteMeetResult[] = [];
  for (const athlete of namedAthletes) {
    const athleteResults = resultsByName[athlete.name] ?? [];
    cachedSessionResults.push(...athleteResults.filter((r) => (r.date ?? "") >= cutoffDate));
  }
  return cachedSessionResults;
}

function uniqueNamedAthletes(athletes: LiftResult[]): string[] {
  return Array.from(
    new Set(athletes.map((athlete) => athlete.name).filter((name) => name?.trim())),
  );
}

export function useAttemptEstimates({
  meet,
  sessionNumber,
  platform,
  hasValidParams,
}: AttemptEstimatesSession): AttemptEstimatesState {
  const [estimates, setEstimates] = useState<AthleteAttemptEstimate[]>([]);
  const [loading, setLoading] = useState(hasValidParams);
  const [refreshing, setRefreshing] = useState(false);
  const [loadIssue, setLoadIssue] = useState<EstimatesLoadIssue>(null);
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    if (!hasValidParams) return;
    const requestId = ++requestIdRef.current;
    const isStale = () => requestId !== requestIdRef.current;
    setLoading(true);
    setRefreshing(false);
    setLoadIssue(null);
    setEstimates([]);
    try {
      const meetId = meet as MeetName;

      const hasNetwork = await isNetworkAvailable();
      if (isStale()) return;
      const cachedSessionAthletes = await getSessionAthletesFromMeetCache(
        meetId,
        sessionNumber,
        platform,
      );

      if (isStale()) return;

      const cutoffDate = getHistoryCutoffDate(ATTEMPT_HISTORY_YEARS);
      if (cachedSessionAthletes.length > 0) {
        const cachedSessionResults = await readCachedSessionResults(
          cachedSessionAthletes,
          cutoffDate,
        );
        if (isStale()) return;
        setEstimates(calculateEstimates(cachedSessionAthletes, cachedSessionResults));
        setLoading(false);
        if (hasNetwork) setRefreshing(true);
      }

      if (!hasNetwork) {
        setLoadIssue("offline");
        return;
      }

      const freshSessionAthletes = filterSessionAthletes(
        await fetchAthletesWithSession(meetId, sessionNumber, platform),
        sessionNumber,
        platform,
      );
      if (isStale()) return;
      if (freshSessionAthletes.length === 0) {
        if (
          freshRosterReplacesShown(freshSessionAthletes.length, cachedSessionAthletes.length)
        ) {
          setEstimates([]);
        }
        return;
      }
      saveSessionAthletes(meetId, sessionNumber, platform, freshSessionAthletes).catch(
        (error) => {
          console.warn("Failed to cache estimator session athletes:", error);
        },
      );

      const freshSessionResults = await fetchRecentAthleteHistoryForNames(
        uniqueNamedAthletes(freshSessionAthletes),
        cutoffDate,
      );
      if (isStale()) return;
      setEstimates(calculateEstimates(freshSessionAthletes, freshSessionResults));
    } catch (error) {
      if (isStale()) return;
      console.error("Error loading data:", error);
      setLoadIssue("failed");
    } finally {
      if (!isStale()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [hasValidParams, sessionNumber, platform, meet]);

  useEffect(() => {
    void reload();
    return () => {
      requestIdRef.current += 1;
    };
  }, [reload]);

  return { estimates, loading, refreshing, loadIssue, reload };
}
