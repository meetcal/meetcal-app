import { LiftResult, SupabaseLiftResult } from '@/data/types/athletes';

export interface AthleteAttemptEstimate {
  id: string;
  athleteName: string;
  snatchEstimates: number[];
  cjEstimates: number[];
  snatchAttemptsOut: number;
  cjAttemptsOut: number;
  averageSnatchIncrease: { first: number; second: number };
  averageCJIncrease: { first: number; second: number };
  snatchMakeRate: number;
  cjMakeRate: number;
  bestSnatch: number | null;
  bestCJ: number | null;
}

interface AttemptData {
  athleteName: string;
  weight: number;
  attemptNumber: number;
  liftType: 'snatch' | 'cj';
}

enum LiftType {
  Snatch = 'snatch',
  CleanJerk = 'cj'
}

function normalizeAthleteName(name: string | null | undefined): string {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function maxSuccessfulAttempt(attempts: Array<number | null | undefined>): number | null {
  const successful = attempts.filter(
    (attempt): attempt is number => typeof attempt === "number" && attempt > 0,
  );
  if (successful.length === 0) return null;
  return Math.max(...successful);
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
      if (result.snatch1 > 0 && result.snatch2 > 0) {
        firstToSecondIncreases.push(Math.abs(result.snatch2 - result.snatch1));
      }
      // Only count 2nd to 3rd if 2nd was positive (successful)
      if (result.snatch2 > 0 && result.snatch3 > 0) {
        secondToThirdIncreases.push(Math.abs(result.snatch3 - result.snatch2));
      }
    } else {
      // Only count increases from positive to positive (both successful)
      if (result.cj1 > 0 && result.cj2 > 0) {
        firstToSecondIncreases.push(Math.abs(result.cj2 - result.cj1));
      }
      // Only count 2nd to 3rd if 2nd was positive (successful)
      if (result.cj2 > 0 && result.cj3 > 0) {
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

function calculateMakeRates(results: SupabaseLiftResult[]): { snatch: number; cj: number } {
  let snatchFirstAttempts = 0;
  let snatchFirstMakes = 0;
  let cjFirstAttempts = 0;
  let cjFirstMakes = 0;

  for (const result of results) {
    if (result.snatch1 > 0) {
      snatchFirstAttempts++;
      const snatchBest = getSnatchBest(result);
      if (snatchBest != null && snatchBest >= result.snatch1) {
        snatchFirstMakes++;
      }
    }

    if (result.cj1 > 0) {
      cjFirstAttempts++;
      const cjBest = getCJBest(result);
      if (cjBest != null && cjBest >= result.cj1) {
        cjFirstMakes++;
      }
    }
  }

  const snatchRate = snatchFirstAttempts > 0 ? snatchFirstMakes / snatchFirstAttempts : 0.0;
  const cjRate = cjFirstAttempts > 0 ? cjFirstMakes / cjFirstAttempts : 0.0;

  return { snatch: snatchRate, cj: cjRate };
}

function calculateAttemptsOutForEstimates(estimates: AthleteAttemptEstimate[]): AthleteAttemptEstimate[] {
  // Create sorted arrays of all attempts
  const snatchAttempts: AttemptData[] = [];
  const cjAttempts: AttemptData[] = [];

  for (const estimate of estimates) {
    for (let index = 0; index < estimate.snatchEstimates.length; index++) {
      const weight = estimate.snatchEstimates[index];
      if (weight > 0) {
        snatchAttempts.push({
          athleteName: estimate.athleteName,
          weight: weight,
          attemptNumber: index + 1,
          liftType: 'snatch'
        });
      }
    }

    for (let index = 0; index < estimate.cjEstimates.length; index++) {
      const weight = estimate.cjEstimates[index];
      if (weight > 0) {
        cjAttempts.push({
          athleteName: estimate.athleteName,
          weight: weight,
          attemptNumber: index + 1,
          liftType: 'cj'
        });
      }
    }
  }

  // Sort by weight
  snatchAttempts.sort((a, b) => a.weight - b.weight);
  cjAttempts.sort((a, b) => a.weight - b.weight);

  // Calculate attempts out for each athlete
  return estimates.map(estimate => {
    let snatchOut = 0;
    let cjOut = 0;

    // Find first snatch attempt
    const firstSnatchIndex = snatchAttempts.findIndex(
      attempt => attempt.athleteName === estimate.athleteName && attempt.attemptNumber === 1
    );

    if (firstSnatchIndex !== -1) {
      // Count attempts before this athlete's first attempt
      // If an athlete appears consecutively, count it as 2 instead of 1
      for (let i = 0; i < firstSnatchIndex; i++) {
        snatchOut++;

        // Check if next attempt is the same athlete (they're following themselves)
        if (
          i + 1 < snatchAttempts.length &&
          i + 1 < firstSnatchIndex &&
          snatchAttempts[i].athleteName === snatchAttempts[i + 1].athleteName
        ) {
          snatchOut++; // Add extra 1 when athlete follows themselves
        }
      }
    }

    // Find first CJ attempt
    const firstCJIndex = cjAttempts.findIndex(
      attempt => attempt.athleteName === estimate.athleteName && attempt.attemptNumber === 1
    );

    if (firstCJIndex !== -1) {
      // Count attempts before this athlete's first attempt
      // If an athlete appears consecutively, count it as 2 instead of 1
      for (let i = 0; i < firstCJIndex; i++) {
        cjOut++;

        // Check if next attempt is the same athlete (they're following themselves)
        if (
          i + 1 < cjAttempts.length &&
          i + 1 < firstCJIndex &&
          cjAttempts[i].athleteName === cjAttempts[i + 1].athleteName
        ) {
          cjOut++; // Add extra 1 when athlete follows themselves
        }
      }
    }

    return {
      ...estimate,
      snatchAttemptsOut: snatchOut,
      cjAttemptsOut: cjOut
    };
  });
}

export function calculateEstimates(
  athletes: LiftResult[],
  athleteResults: SupabaseLiftResult[]
): AthleteAttemptEstimate[] {
  // Calculate two years ago date
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const twoYearsAgoString = twoYearsAgo.toISOString().split('T')[0];

  // First pass: collect all estimates from athletes WITH history to calculate session averages
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
        result.date >= twoYearsAgoString
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
      snatchAttemptsOut: 0, // Will calculate after all estimates
      cjAttemptsOut: 0, // Will calculate after all estimates
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
