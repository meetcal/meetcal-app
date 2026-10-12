import { LiftResult, SupabaseLiftResult } from '@/data/types/athletes';
import {
  maxSuccessfulAttempt,
  normalizeAthleteName,
  wasAttemptMade,
  wasAttemptTaken,
} from '@/lib/athletes';
import {
  ATTEMPT_HISTORY_YEARS,
  getHistoryCutoffDate,
  toMeetCalendarDate,
} from '@/utils/dateTime';

export interface AthleteAttemptEstimate {
  id: string;
  athleteName: string;
  snatchEstimates: number[];
  cjEstimates: number[];
  /**
   * Attempts on the platform before this athlete's opener, or `null` when the
   * athlete has no estimated opener for the lift (no history and no entry
   * total), so the count is unknown rather than zero.
   */
  snatchAttemptsOut: number | null;
  cjAttemptsOut: number | null;
  averageSnatchIncrease: { first: number; second: number };
  averageCJIncrease: { first: number; second: number };
  snatchMakeRate: number;
  cjMakeRate: number;
  bestSnatch: number | null;
  bestCJ: number | null;
}

interface AttemptData {
  /** Position of the athlete in the session list: identity and last tiebreak. */
  athleteIndex: number;
  weight: number;
  attemptNumber: number;
}

enum LiftType {
  Snatch = 'snatch',
  CleanJerk = 'cj'
}

function getSnatchBest(result: SupabaseLiftResult): number | null {
  if (typeof result.snatch_best === "number" && result.snatch_best > 0) {
    return result.snatch_best;
  }
  return maxSuccessfulAttempt([result.snatch1, result.snatch2, result.snatch3]);
}

function getCJBest(result: SupabaseLiftResult): number | null {
  if (typeof result.cj_best === "number" && result.cj_best > 0) {
    return result.cj_best;
  }
  return maxSuccessfulAttempt([result.cj1, result.cj2, result.cj3]);
}

function calculateAverageIncrease(
  results: SupabaseLiftResult[],
  liftType: LiftType
): { first: number; second: number } {
  const firstToSecondIncreases: number[] = [];
  const secondToThirdIncreases: number[] = [];

  for (const result of results) {
    if (liftType === LiftType.Snatch) {
      // Only count increases from positive to positive (both successful)
      if (result.snatch1 != null && result.snatch2 != null && result.snatch1 > 0 && result.snatch2 > 0) {
        firstToSecondIncreases.push(Math.abs(result.snatch2 - result.snatch1));
      }
      // Only count 2nd to 3rd if 2nd was positive (successful)
      if (result.snatch2 != null && result.snatch3 != null && result.snatch2 > 0 && result.snatch3 > 0) {
        secondToThirdIncreases.push(Math.abs(result.snatch3 - result.snatch2));
      }
    } else {
      // Only count increases from positive to positive (both successful)
      if (result.cj1 != null && result.cj2 != null && result.cj1 > 0 && result.cj2 > 0) {
        firstToSecondIncreases.push(Math.abs(result.cj2 - result.cj1));
      }
      // Only count 2nd to 3rd if 2nd was positive (successful)
      if (result.cj2 != null && result.cj3 != null && result.cj2 > 0 && result.cj3 > 0) {
        secondToThirdIncreases.push(Math.abs(result.cj3 - result.cj2));
      }
    }
  }

  const avgFirstToSecond = firstToSecondIncreases.length === 0
    ? 3
    : Math.round(firstToSecondIncreases.reduce((a, b) => a + b, 0) / firstToSecondIncreases.length);

  const avgSecondToThird = secondToThirdIncreases.length === 0
    ? 3
    : Math.round(secondToThirdIncreases.reduce((a, b) => a + b, 0) / secondToThirdIncreases.length);

  return { first: avgFirstToSecond, second: avgSecondToThird };
}

/**
 * Share of **openers** the athlete made, per lift.
 *
 * Attempt classification is the shared convention in `lib/athletes.ts`: a
 * non-zero number was taken, a positive number was made.
 *
 * This is deliberately a different measurement from
 * `lib/wrapped-stats.ts`'s `makePercentage`, not a disagreeing definition of
 * the same one. Wrapped scores all six attempts of a calendar year to tell the
 * athlete how consistent they were. Here we are predicting the opener we are
 * about to print, so second and third attempts — which are *chosen in reaction
 * to* the opener, and are taken at all only when the opener went a certain way
 * — would bias the estimate. Openers only, split by lift.
 */
function calculateMakeRates(results: SupabaseLiftResult[]): { snatch: number; cj: number } {
  let snatchFirstAttempts = 0;
  let snatchFirstMakes = 0;
  let cjFirstAttempts = 0;
  let cjFirstMakes = 0;

  for (const result of results) {
    if (wasAttemptTaken(result.snatch1)) {
      snatchFirstAttempts++;
      if (wasAttemptMade(result.snatch1)) snatchFirstMakes++;
    }

    if (wasAttemptTaken(result.cj1)) {
      cjFirstAttempts++;
      if (wasAttemptMade(result.cj1)) cjFirstMakes++;
    }
  }

  const snatchRate = snatchFirstAttempts > 0 ? snatchFirstMakes / snatchFirstAttempts : 0.0;
  const cjRate = cjFirstAttempts > 0 ? cjFirstMakes / cjFirstAttempts : 0.0;

  return { snatch: snatchRate, cj: cjRate };
}

/**
 * Platform order for one lift: lighter bars first; at the same weight the
 * lower attempt number lifts first (an athlete's opener at 83 goes before
 * someone else's second attempt at 83). A remaining tie, same weight and same
 * attempt number, keeps start-list order, standing in for the lot number the
 * start list does not carry.
 */
function compareAttemptOrder(a: AttemptData, b: AttemptData): number {
  return (
    a.weight - b.weight ||
    a.attemptNumber - b.attemptNumber ||
    a.athleteIndex - b.athleteIndex
  );
}

/** Every estimated attempt of one lift for the whole session, in platform order. */
function platformOrder(perAthlete: number[][]): AttemptData[] {
  const attempts: AttemptData[] = [];
  perAthlete.forEach((weights, athleteIndex) => {
    weights.forEach((weight, index) => {
      if (weight > 0) {
        attempts.push({ athleteIndex, weight, attemptNumber: index + 1 });
      }
    });
  });
  return attempts.sort(compareAttemptOrder);
}

/**
 * Attempts before `athleteIndex`'s opener in `order`, or `null` when the
 * athlete has no estimated opener. An attempt followed straight away by the
 * same athlete's next one counts twice: the lifter following themselves gets
 * the longer clock, so it costs the warm-up room about two attempts.
 */
function countAttemptsOut(order: AttemptData[], athleteIndex: number): number | null {
  const openerIndex = order.findIndex(
    (attempt) => attempt.athleteIndex === athleteIndex && attempt.attemptNumber === 1,
  );
  if (openerIndex === -1) return null;

  let out = 0;
  for (let i = 0; i < openerIndex; i++) {
    out++;
    if (i + 1 < openerIndex && order[i].athleteIndex === order[i + 1].athleteIndex) {
      out++;
    }
  }
  return out;
}

function calculateAttemptsOutForEstimates(estimates: AthleteAttemptEstimate[]): AthleteAttemptEstimate[] {
  // Athletes are keyed by position, not name: two lifters can share a name.
  const snatchOrder = platformOrder(estimates.map((estimate) => estimate.snatchEstimates));
  const cjOrder = platformOrder(estimates.map((estimate) => estimate.cjEstimates));

  return estimates.map((estimate, athleteIndex) => ({
    ...estimate,
    snatchAttemptsOut: countAttemptsOut(snatchOrder, athleteIndex),
    cjAttemptsOut: countAttemptsOut(cjOrder, athleteIndex),
  }));
}

/**
 * The estimator list order: by snatch attempts out, soonest first, with the
 * athletes whose count is unknown last (they are not opening first, we just
 * cannot say when they open). Stable, so ties keep start-list order.
 */
export function sortEstimatesByAttemptsOut(
  estimates: readonly AthleteAttemptEstimate[],
): AthleteAttemptEstimate[] {
  return [...estimates].sort((a, b) => {
    if (a.snatchAttemptsOut === null || b.snatchAttemptsOut === null) {
      return (a.snatchAttemptsOut === null ? 1 : 0) - (b.snatchAttemptsOut === null ? 1 : 0);
    }
    return a.snatchAttemptsOut - b.snatchAttemptsOut;
  });
}

/** "3 attempts out", or "—" when the count is unknown. */
export function formatAttemptsOut(attemptsOut: number | null): string {
  if (attemptsOut === null) return "—";
  return `${attemptsOut} ${attemptsOut === 1 ? "attempt" : "attempts"} out`;
}

/**
 * The `YYYY-MM-DD` a result belongs to, for string comparison against the
 * history cutoff.
 *
 * Results carry calendar dates, so the date part is taken verbatim. Routing
 * `"2026-06-20T00:00:00"` through `new Date(...)` instead parses it in the
 * *device* timezone and `toISOString()` then hands back the previous day west
 * of UTC, silently dropping the oldest day of every athlete's history window.
 */
function normalizeDate(raw: string | null | undefined): string {
  if (!raw) return "";
  const calendarDate = toMeetCalendarDate(raw);
  if (calendarDate) return calendarDate;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toISOString().split("T")[0];
}

export function calculateEstimates(
  athletes: LiftResult[],
  athleteResults: SupabaseLiftResult[]
): AthleteAttemptEstimate[] {
  // Same window the screen fetched with, from the same helper — a second
  // hand-rolled copy here would silently filter out rows the fetch paid for.
  const historyCutoffDate = getHistoryCutoffDate(ATTEMPT_HISTORY_YEARS);

  const tempEstimates: {
    athlete: LiftResult;
    history: SupabaseLiftResult[];
    bestSnatch: number | null;
    bestCJ: number | null;
    avgSnatchIncrease: { first: number; second: number };
    avgCJIncrease: { first: number; second: number };
    snatchMakeRate: number;
    cjMakeRate: number;
  }[] = [];

  for (const athlete of athletes) {
    const normalizedAthleteName = normalizeAthleteName(athlete.name);
    const athleteHistory = athleteResults.filter(
      result =>
        normalizeAthleteName(result.name) === normalizedAthleteName &&
        normalizeDate(result.date) >= historyCutoffDate
    );

    const bestSnatchCandidates = athleteHistory
      .map((r) => getSnatchBest(r))
      .filter((v): v is number => v != null && v > 0);
    const bestCJCandidates = athleteHistory
      .map((r) => getCJBest(r))
      .filter((v): v is number => v != null && v > 0);
    const bestSnatch =
      bestSnatchCandidates.length > 0 ? Math.max(...bestSnatchCandidates) : null;
    const bestCJ =
      bestCJCandidates.length > 0 ? Math.max(...bestCJCandidates) : null;

    const avgSnatchIncrease = calculateAverageIncrease(athleteHistory, LiftType.Snatch);
    const avgCJIncrease = calculateAverageIncrease(athleteHistory, LiftType.CleanJerk);
    const makeRates = calculateMakeRates(athleteHistory);

    tempEstimates.push({
      athlete,
      history: athleteHistory,
      bestSnatch: bestSnatch && bestSnatch > 0 ? bestSnatch : null,
      bestCJ: bestCJ && bestCJ > 0 ? bestCJ : null,
      avgSnatchIncrease,
      avgCJIncrease,
      snatchMakeRate: makeRates.snatch,
      cjMakeRate: makeRates.cj
    });
  }

  // Calculate session average jumps from athletes with history
  const sessionSnatchJumps = tempEstimates
    .filter(e => e.bestSnatch !== null && e.bestSnatch > 0)
    .map(e => e.avgSnatchIncrease);

  const sessionCJJumps = tempEstimates
    .filter(e => e.bestCJ !== null && e.bestCJ > 0)
    .map(e => e.avgCJIncrease);

  const sessionAvgSnatchJump1to2 = sessionSnatchJumps.length === 0
    ? 3
    : Math.round(sessionSnatchJumps.reduce((sum, j) => sum + j.first, 0) / sessionSnatchJumps.length);

  const sessionAvgSnatchJump2to3 = sessionSnatchJumps.length === 0
    ? 3
    : Math.round(sessionSnatchJumps.reduce((sum, j) => sum + j.second, 0) / sessionSnatchJumps.length);

  const sessionAvgCJJump1to2 = sessionCJJumps.length === 0
    ? 4
    : Math.round(sessionCJJumps.reduce((sum, j) => sum + j.first, 0) / sessionCJJumps.length);

  const sessionAvgCJJump2to3 = sessionCJJumps.length === 0
    ? 4
    : Math.round(sessionCJJumps.reduce((sum, j) => sum + j.second, 0) / sessionCJJumps.length);

  // Second pass: create estimates for all athletes
  const estimates: AthleteAttemptEstimate[] = [];

  for (const tempEstimate of tempEstimates) {
    const { athlete, bestSnatch, bestCJ, avgSnatchIncrease, avgCJIncrease, snatchMakeRate, cjMakeRate } = tempEstimate;

    let snatchEstimates: number[] = [];
    let cjEstimates: number[] = [];
    let finalAvgSnatchIncrease = avgSnatchIncrease;
    let finalAvgCJIncrease = avgCJIncrease;

    // Use history if available, otherwise use entry total
    if (bestSnatch !== null && bestSnatch > 0) {
      const firstAttempt = Math.round(bestSnatch * 0.93);
      const secondAttempt = firstAttempt + avgSnatchIncrease.first;
      const thirdAttempt = secondAttempt + avgSnatchIncrease.second;
      snatchEstimates = [firstAttempt, secondAttempt, thirdAttempt];
    } else if (athlete.entryTotal > 0) {
      // No history - use entry total
      const estimatedTotal = Math.round(athlete.entryTotal * 0.93);
      const snatchOpener = Math.round(estimatedTotal * 0.43);
      const secondAttempt = snatchOpener + sessionAvgSnatchJump1to2;
      const thirdAttempt = secondAttempt + sessionAvgSnatchJump2to3;
      snatchEstimates = [snatchOpener, secondAttempt, thirdAttempt];
      finalAvgSnatchIncrease = { first: sessionAvgSnatchJump1to2, second: sessionAvgSnatchJump2to3 };
    }

    if (bestCJ !== null && bestCJ > 0) {
      const firstAttempt = Math.round(bestCJ * 0.93);
      const secondAttempt = firstAttempt + avgCJIncrease.first;
      const thirdAttempt = secondAttempt + avgCJIncrease.second;
      cjEstimates = [firstAttempt, secondAttempt, thirdAttempt];
    } else if (athlete.entryTotal > 0) {
      // No history - use entry total
      const estimatedTotal = Math.round(athlete.entryTotal * 0.93);
      const cjOpener = Math.round(estimatedTotal * 0.57);
      const secondAttempt = cjOpener + sessionAvgCJJump1to2;
      const thirdAttempt = secondAttempt + sessionAvgCJJump2to3;
      cjEstimates = [cjOpener, secondAttempt, thirdAttempt];
      finalAvgCJIncrease = { first: sessionAvgCJJump1to2, second: sessionAvgCJJump2to3 };
    }

    estimates.push({
      id: athlete.memberId || athlete.name,
      athleteName: athlete.name,
      snatchEstimates,
      cjEstimates,
      snatchAttemptsOut: null, // Will calculate after all estimates
      cjAttemptsOut: null, // Will calculate after all estimates
      averageSnatchIncrease: finalAvgSnatchIncrease,
      averageCJIncrease: finalAvgCJIncrease,
      bestSnatch,
      bestCJ,
      snatchMakeRate,
      cjMakeRate
    });
  }

  // Calculate attempts out for each athlete
  return calculateAttemptsOutForEstimates(estimates);
}

export function generateAthleteNotes(estimate: AthleteAttemptEstimate): string {
  // Check if athlete has no historical data
  if (estimate.bestSnatch === null && estimate.bestCJ === null) {
    return "No data within the past 2 years. Estimates are based on entry total.";
  }

  const notes: string[] = [];

  const averageSnatchIncrease = Math.round(
    (estimate.averageSnatchIncrease.first + estimate.averageSnatchIncrease.second) / 2
  );

  const averageCJIncrease = Math.round(
    (estimate.averageCJIncrease.first + estimate.averageCJIncrease.second) / 2
  );

  if (estimate.snatchEstimates.length > 0 && estimate.snatchEstimates[0] > 0) {
    notes.push(
      `${estimate.athleteName} typically takes ${averageSnatchIncrease}kg jumps in the Snatch, ${Math.round(estimate.snatchMakeRate * 100)}% opener make rate`
    );
  }

  if (estimate.cjEstimates.length > 0 && estimate.cjEstimates[0] > 0) {
    notes.push(
      `They take ${averageCJIncrease}kg jumps in the Clean & Jerk, ${Math.round(estimate.cjMakeRate * 100)}% opener make rate`
    );
  }

  return notes.length === 0 ? "No data available" : notes.join(". ") + ".";
}
