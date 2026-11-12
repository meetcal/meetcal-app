import { useRetryOnReconnect } from "@/hooks/useRetryOnReconnect";
import {
  canRetryFullHistory,
  loadAthleteResults,
  type AthleteResultsOutcome,
  type ShownResultsSource,
} from "@/lib/athlete-results-load";
import { getAllCachedLiftingResultsForAthlete } from "@/lib/database/athlete-history-store";
import { fetchAllResultsForName } from "@/lib/database/queries";
import { readBrowsedAthleteResults, saveBrowsedAthleteResults } from "@/lib/database/browsed-athlete-results";
import type { AthleteMeetResult } from "@/types/athlete-results";
import { useCallback, useEffect, useRef, useState } from "react";

type KeptRowsOnScreen = { name: string; rows: AthleteMeetResult[]; source: Exclude<ShownResultsSource, "api"> };

export type AthleteResultsState = {
  loading: boolean;
  athleteResults: AthleteMeetResult[];
  loadFailed: boolean;
  rowsSource: ShownResultsSource | null;
  loadOutcome: AthleteResultsOutcome | null;
  retryLoad: () => void;
};

function useSessionResultsCache() {
  const resultsCacheRef = useRef<Map<string, AthleteMeetResult[]>>(new Map());
  useEffect(() => {
    const cache = resultsCacheRef.current;
    return () => {
      cache.clear();
    };
  }, []);
  return resultsCacheRef;
}

export function useAthleteResults(name: string | undefined): AthleteResultsState {
  const [loading, setLoading] = useState(true);
  const [athleteResults, setAthleteResults] = useState<AthleteMeetResult[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [rowsSource, setRowsSource] = useState<ShownResultsSource | null>(null);
  const [loadOutcome, setLoadOutcome] = useState<AthleteResultsOutcome | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const resultsCacheRef = useSessionResultsCache();
  const requestIdRef = useRef(0);
  const keptRowsRef = useRef<KeptRowsOnScreen | null>(null);

  useEffect(() => {
    const fetchAthleteResults = async () => {
      if (!name) return;

      const nameStr = Array.isArray(name) ? name[0] : name;
      const cacheKey = `all::${nameStr}`;
      const cachedResults = resultsCacheRef.current.get(cacheKey);
      setLoadFailed(false);
      setLoadOutcome(null);
      if (cachedResults) {
        keptRowsRef.current = null;
        setAthleteResults(cachedResults);
        setRowsSource("api");
        setLoading(false);
      } else if (keptRowsRef.current?.name !== nameStr) {
        keptRowsRef.current = null;
        setAthleteResults([]);
        setRowsSource(null);
        setLoading(true);
      }
      const kept = cachedResults ? null : keptRowsRef.current;

      const requestId = ++requestIdRef.current;
      try {
        const outcome = await loadAthleteResults({
          shown: cachedResults ?? kept?.rows,
          shownSource: cachedResults ? "api" : kept?.source,
          readOffline: () => getAllCachedLiftingResultsForAthlete(nameStr),
          readBrowsed: () => readBrowsedAthleteResults(nameStr),
          rememberFull: (rows) => saveBrowsedAthleteResults(nameStr, rows),
          fetchFull: () => fetchAllResultsForName(nameStr),
          isCurrent: () => requestId === requestIdRef.current,
          show: (rows, source) => {
            if (source === "api") {
              resultsCacheRef.current.set(cacheKey, rows);
            }
            keptRowsRef.current = source === "api" ? null : { name: nameStr, rows, source };
            setAthleteResults(rows);
            setRowsSource(source);
            if (source !== "api") setLoading(false);
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

    void fetchAthleteResults();
    return () => {
      requestIdRef.current += 1;
    };
  }, [name, retryCount, resultsCacheRef]);

  const retryLoad = useCallback(() => setRetryCount((count) => count + 1), []);
  useRetryOnReconnect(canRetryFullHistory(loadOutcome), retryLoad);

  return { loading, athleteResults, loadFailed, rowsSource, loadOutcome, retryLoad };
}
