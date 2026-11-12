import { useRetryOnReconnect } from "@/hooks/useRetryOnReconnect";
import type { AthleteRequest } from "@/lib/api/results-api";
import {
  canRetryFullHistory,
  loadAthleteResults,
  type ApiDetails,
  type AthleteChoice,
  type AthleteResultsOutcome,
  type ShownResultsSource,
} from "@/lib/athlete-results-load";
import { athleteRequestKey, rowsForRequest } from "@/lib/athlete-results-route";
import { getAllCachedLiftingResultsForAthlete } from "@/lib/database/athlete-history-store";
import { readBrowsedAthleteResults, saveBrowsedAthleteResults } from "@/lib/database/browsed-athlete-results";
import { fetchAthleteResults } from "@/lib/database/queries";
import type { AthleteMeetResult } from "@/types/athlete-results";
import { useCallback, useEffect, useRef, useState } from "react";

type KeptRowsOnScreen = {
  key: string;
  rows: AthleteMeetResult[];
  details: ApiDetails | null;
  source: Exclude<ShownResultsSource, "api">;
};

type AnsweredPage =
  | { kind: "rows"; rows: AthleteMeetResult[]; details: ApiDetails }
  | { kind: "choice"; choice: AthleteChoice };

export type AthleteResultsState = {
  loading: boolean;
  athleteResults: AthleteMeetResult[];
  details: ApiDetails | null;
  choice: AthleteChoice | null;
  loadFailed: boolean;
  rowsSource: ShownResultsSource | null;
  loadOutcome: AthleteResultsOutcome | null;
  retryLoad: () => void;
};

function useSessionResultsCache() {
  const resultsCacheRef = useRef<Map<string, AnsweredPage>>(new Map());
  useEffect(() => {
    const cache = resultsCacheRef.current;
    return () => {
      cache.clear();
    };
  }, []);
  return resultsCacheRef;
}

export function useAthleteResults(request: AthleteRequest | null): AthleteResultsState {
  const [loading, setLoading] = useState(true);
  const [athleteResults, setAthleteResults] = useState<AthleteMeetResult[]>([]);
  const [details, setDetails] = useState<ApiDetails | null>(null);
  const [choice, setChoice] = useState<AthleteChoice | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [rowsSource, setRowsSource] = useState<ShownResultsSource | null>(null);
  const [loadOutcome, setLoadOutcome] = useState<AthleteResultsOutcome | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const resultsCacheRef = useSessionResultsCache();
  const requestIdRef = useRef(0);
  const keptRowsRef = useRef<KeptRowsOnScreen | null>(null);

  useEffect(() => {
    if (!request) return;
    const key = athleteRequestKey(request);
    const showRows = (rows: AthleteMeetResult[], source: ShownResultsSource | null, shownDetails: ApiDetails | null) => {
      setChoice(null);
      setAthleteResults(rows);
      setDetails(shownDetails);
      setRowsSource(source);
    };
    const showChoice = (answer: AthleteChoice) => {
      setChoice(answer);
      setAthleteResults([]);
      setDetails(null);
      setRowsSource(null);
    };

    const cached = resultsCacheRef.current.get(key);
    setLoadFailed(false);
    setLoadOutcome(null);
    if (cached?.kind === "choice") {
      keptRowsRef.current = null;
      showChoice(cached.choice);
      setLoading(false);
      return;
    }
    if (cached) {
      keptRowsRef.current = null;
      showRows(cached.rows, "api", cached.details);
      setLoading(false);
    } else if (keptRowsRef.current?.key !== key) {
      keptRowsRef.current = null;
      showRows([], null, null);
      setLoading(true);
    }
    const kept = cached ? null : keptRowsRef.current;

    const requestId = ++requestIdRef.current;
    const load = async () => {
      try {
        const outcome = await loadAthleteResults({
          shown: cached?.rows ?? kept?.rows,
          shownSource: cached ? "api" : kept?.source,
          readOffline: async () => rowsForRequest(await getAllCachedLiftingResultsForAthlete(request.name), request),
          readBrowsed: () => readBrowsedAthleteResults(request),
          rememberFull: (rows, shownDetails) => saveBrowsedAthleteResults(request, rows, shownDetails),
          fetchFull: () => fetchAthleteResults(request),
          isCurrent: () => requestId === requestIdRef.current,
          show: (rows, source, shownDetails) => {
            if (source === "api" && shownDetails) {
              resultsCacheRef.current.set(key, { kind: "rows", rows, details: shownDetails });
            }
            keptRowsRef.current = source === "api" ? null : { key, rows, details: shownDetails, source };
            showRows(rows, source, shownDetails);
            if (source !== "api") setLoading(false);
          },
          choose: (answer) => {
            resultsCacheRef.current.set(key, { kind: "choice", choice: answer });
            keptRowsRef.current = null;
            showChoice(answer);
          },
        });
        if (outcome === "superseded") return;
        setLoadOutcome(outcome);
        if (outcome === "failed") setLoadFailed(true);
      } catch (error) {
        console.error("Error in fetchAthleteResults:", error);
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [request, retryCount, resultsCacheRef]);

  const retryLoad = useCallback(() => setRetryCount((count) => count + 1), []);
  useRetryOnReconnect(canRetryFullHistory(loadOutcome), retryLoad);

  return { loading, athleteResults, details, choice, loadFailed, rowsSource, loadOutcome, retryLoad };
}
