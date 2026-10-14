import { useEffect, useState } from "react";

import type { LiftResult } from "@/data/types/athletes";
import {
  getLastYearBestsBatch,
  preloadYearBests,
  type YearBests,
} from "@/lib/start-list-api";

/**
 * The start list opens on the "A" letter filter, so the names the user is
 * about to see get their year bests fetched first, so expanding a row reads
 * them from memory instead of sending its own requests. The cap bounds it: a
 * federation-scale roster has hundreds of A-names, and the cap keeps the warm
 * inside one `SMALL_ROWS_NAMES_CHUNK_SIZE` request (plus one `latest_only`
 * request for the names with nothing in the window) rather than a dozen
 * against the screen the user is actively scrolling.
 */
export const YEAR_BESTS_PREFETCH_NAME_CAP = 80;

/** Let the list paint and settle before spending bandwidth on the warm. */
export const YEAR_BESTS_PREFETCH_DELAY_MS = 500;

/**
 * Warms the year bests of the roster's first names starting with "A", while
 * `enabled`: bests are premium, so only a subscriber's start list asks the
 * server for them.
 */
export function usePreloadYearBests(athletes: readonly LiftResult[], enabled: boolean): void {
  useEffect(() => {
    if (!enabled || athletes.length === 0) return;
    const firstNameStartsWithA = (athlete: LiftResult) =>
      ((athlete.name || "").trim().split(/\s+/)[0] || "")
        .toUpperCase()
        .startsWith("A");
    const aNames = athletes.filter(firstNameStartsWithA).map((athlete) => athlete.name);
    if (aNames.length === 0) return;
    const timer = setTimeout(
      () => preloadYearBests(aNames.slice(0, YEAR_BESTS_PREFETCH_NAME_CAP)),
      YEAR_BESTS_PREFETCH_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [athletes, enabled]);
}

/**
 * Every athlete's bests from the last year, keyed by name, while `enabled`
 * (a best-lift sort is applied). Kept from the last load when disabled.
 */
export function useYearBestsForSort(
  athletes: readonly LiftResult[],
  enabled: boolean,
): Record<string, YearBests> {
  const [bests, setBests] = useState<Record<string, YearBests>>({});

  useEffect(() => {
    if (!enabled) return;
    if (athletes.length === 0) {
      setBests({});
      return;
    }

    let isCancelled = false;
    const uniqueNames = Array.from(
      new Set(athletes.map((athlete) => athlete.name).filter(Boolean)),
    );
    getLastYearBestsBatch(uniqueNames)
      .then((loaded) => {
        if (!isCancelled) setBests(loaded);
      })
      .catch((error) => {
        if (isCancelled) return;
        console.warn("StartList: Failed to load athlete bests", error);
        setBests({});
      });

    return () => {
      isCancelled = true;
    };
  }, [athletes, enabled]);

  return bests;
}
