/**
 * What an athlete's stored "bests" mean, and the one lookup that writes them.
 *
 * Session details (`lib/athlete-bests`) and the start list
 * (`lib/start-list-api`) read and write the same per-name entry in
 * `offline-store`. They used to resolve it differently: session details stored
 * all-null (or bests from any downloaded meet) when the year window was empty,
 * the start list stored the athlete's most recent meet. Which one the user saw
 * depended on which screen ran first. Both now go through
 * `lookUpAthleteBests`: bests inside the year-bests window, else the athlete's
 * most recent meet, stored.
 *
 * The derivation helpers are the client copy of the server's rule
 * (`convex/lib/results.ts` `accumulateBests`), used for the most-recent-meet
 * fallback and for the offline fallback both screens build from downloaded
 * meets.
 */
import type { SupabaseBests, SupabaseLiftResult } from "@/data/types/athletes";
import { fetchApiResultsByNames, fetchApiYearBestsByNames } from "@/lib/api/meetcal-api";
import { maxSuccessfulAttempt, normalizeAthleteName } from "@/lib/athletes";
import { hasAnyAthleteBest, saveAthleteBestsBatch } from "@/lib/database/offline-store";
import {
  getHistoryCutoffDate,
  toMeetCalendarDate,
  YEAR_BESTS_YEARS,
} from "@/utils/dateTime";

type ResultRowLifts = Pick<
  SupabaseLiftResult,
  "snatch_best" | "cj_best" | "total" | "snatch1" | "snatch2" | "snatch3" | "cj1" | "cj2" | "cj3"
>;

export function emptyBests(): SupabaseBests {
  return { snatch_best: null, cj_best: null, total: null };
}

/**
 * The bests one result row shows. A recorded total is used as-is: 0 is how a
 * bomb-out is recorded, so it means "no total", never snatch + C&J (that made
 * an 80 kg snatch with three missed C&Js read as an 80 kg total). Only a row
 * with no total at all gets one summed, and only from two made lifts.
 */
export function deriveRowBests(row: Partial<ResultRowLifts>): SupabaseBests {
  const snatch = maxSuccessfulAttempt([row.snatch_best, row.snatch1, row.snatch2, row.snatch3]);
  const cj = maxSuccessfulAttempt([row.cj_best, row.cj1, row.cj2, row.cj3]);
  let total: number | null;
  if (typeof row.total === "number") {
    total = row.total > 0 ? row.total : null;
  } else {
    total = snatch != null && cj != null ? snatch + cj : null;
  }
  return { snatch_best: snatch, cj_best: cj, total };
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

/** Each lift's best across the rows (all-null for none). */
export function deriveBestsFromResults(rows: readonly Partial<ResultRowLifts>[]): SupabaseBests {
  let bests = emptyBests();
  for (const row of rows) {
    const next = deriveRowBests(row);
    bests = {
      snatch_best: maxNullable(bests.snatch_best, next.snatch_best),
      cj_best: maxNullable(bests.cj_best, next.cj_best),
      total: maxNullable(bests.total, next.total),
    };
  }
  return bests;
}

/** Bests from the athlete's most recent meet only (the newest date's rows of that meet). */
export function deriveMostRecentMeetBests(rows: readonly SupabaseLiftResult[]): SupabaseBests {
  if (rows.length === 0) return emptyBests();
  const latest = rows.reduce((newest, r) => ((r.date ?? "") > (newest.date ?? "") ? r : newest));
  return deriveBestsFromResults(
    rows.filter((r) => r.date === latest.date && r.meet === latest.meet),
  );
}

/**
 * Bests from downloaded results with the same meaning as an online answer:
 * the rows inside the year-bests window (an undated row counts as inside),
 * else the most recent meet. Result dates are calendar dates, compared as
 * `YYYY-MM-DD` strings, never through `new Date`.
 */
export function deriveDownloadedBests(
  rows: readonly SupabaseLiftResult[],
  cutoffDate: string = getHistoryCutoffDate(YEAR_BESTS_YEARS),
): SupabaseBests {
  const recent = rows.filter((r) => {
    const day = toMeetCalendarDate(r.date);
    return !day || day >= cutoffDate;
  });
  return recent.length > 0 ? deriveBestsFromResults(recent) : deriveMostRecentMeetBests(rows);
}

/** API bests (0 for none) in the stored, nullable form. */
function fromApiBests(row: { bestSnatch: number; bestCJ: number; bestTotal: number }): SupabaseBests {
  return {
    snatch_best: row.bestSnatch > 0 ? row.bestSnatch : null,
    cj_best: row.bestCJ > 0 ? row.bestCJ : null,
    total: row.bestTotal > 0 ? row.bestTotal : null,
  };
}

/**
 * The most recent meet's bests for each name, from `latest_only` rows.
 * `latest_only` bounds rows per folded name, so rows are grouped by the same
 * fold rather than by raw spelling. Null when the request failed.
 */
async function fetchMostRecentMeetBests(
  names: string[],
): Promise<Record<string, SupabaseBests> | null> {
  let rows: SupabaseLiftResult[];
  try {
    rows = await fetchApiResultsByNames(names, { latestOnly: true });
  } catch {
    return null;
  }
  const grouped = new Map<string, SupabaseLiftResult[]>();
  for (const row of rows) {
    const key = normalizeAthleteName(row.name);
    const group = grouped.get(key);
    if (group) group.push(row);
    else grouped.set(key, [row]);
  }
  const byName: Record<string, SupabaseBests> = {};
  for (const name of names) {
    byName[name] = deriveMostRecentMeetBests(grouped.get(normalizeAthleteName(name)) ?? []);
  }
  return byName;
}

export type AthleteBestsLookup = {
  /**
   * What the API answered, keyed by the caller's spellings and stored:
   * bests inside the window, else the most recent meet's, else all-null
   * ("no results", which `offline-store` expires sooner).
   */
  answered: Record<string, SupabaseBests>;
  /**
   * Names with nothing inside the window whose most-recent-meet lookup
   * failed. Not an answer, so nothing is stored for them.
   */
  unanswered: string[];
};

/**
 * Looks the names up and stores the answers. The one writer of looked-up
 * bests (the meet package stores window bests with real numbers only, which
 * is the first step of this rule). Rejects, storing nothing, when the window
 * lookup fails. A failed write is logged, not thrown: it only costs the next
 * view a lookup.
 */
export async function lookUpAthleteBests(names: readonly string[]): Promise<AthleteBestsLookup> {
  const uniqueNames = Array.from(new Set(names.filter(Boolean)));
  const answered: Record<string, SupabaseBests> = {};
  if (uniqueNames.length === 0) return { answered, unanswered: [] };

  const windowed = await fetchApiYearBestsByNames(
    uniqueNames,
    getHistoryCutoffDate(YEAR_BESTS_YEARS),
  );
  const emptyNames: string[] = [];
  for (const name of uniqueNames) {
    const row = windowed[name];
    const bests = row ? fromApiBests(row) : emptyBests();
    if (hasAnyAthleteBest(bests)) answered[name] = bests;
    else emptyNames.push(name);
  }

  let unanswered: string[] = [];
  if (emptyNames.length > 0) {
    const latest = await fetchMostRecentMeetBests(emptyNames);
    if (latest) {
      for (const name of emptyNames) answered[name] = latest[name] ?? emptyBests();
    } else {
      unanswered = emptyNames;
    }
  }

  if (Object.keys(answered).length > 0) {
    try {
      await saveAthleteBestsBatch(answered);
    } catch (error) {
      console.warn("Could not store athlete bests:", error);
    }
  }
  return { answered, unanswered };
}
