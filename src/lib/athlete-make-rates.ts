import type { SupabaseLiftResult } from '@/data/types/athletes';
import { wasAttemptMade, wasAttemptTaken } from '@/lib/athletes';

/** Makes out of attempts taken, and the share as a percentage (0 when none). */
export interface AttemptTally {
  makes: number;
  total: number;
  rate: number;
}

export interface AttemptRates {
  attempt1: AttemptTally;
  attempt2: AttemptTally;
  attempt3: AttemptTally;
}

/** The athlete results screen's "Success Rates" card. */
export interface AthleteMakeRates {
  /** Percent of all taken snatch attempts that were made. */
  snatchMakeRate: number;
  cjMakeRate: number;
  totalSnatchAttempts: number;
  totalCJAttempts: number;
  snatchAttemptRates: AttemptRates;
  cjAttemptRates: AttemptRates;
}

function tally(makes: number, total: number): AttemptTally {
  return { makes, total, rate: total > 0 ? (makes / total) * 100 : 0 };
}

/** One lift's three attempt slots across every result, by attempt number. */
function rateLift(attemptsPerResult: (number | null | undefined)[][]): {
  overall: AttemptTally;
  byAttempt: AttemptRates;
} {
  const makes = [0, 0, 0];
  const taken = [0, 0, 0];
  for (const attempts of attemptsPerResult) {
    attempts.forEach((attempt, index) => {
      if (!wasAttemptTaken(attempt)) return;
      taken[index]++;
      if (wasAttemptMade(attempt)) makes[index]++;
    });
  }
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  return {
    overall: tally(sum(makes), sum(taken)),
    byAttempt: {
      attempt1: tally(makes[0], taken[0]),
      attempt2: tally(makes[1], taken[1]),
      attempt3: tally(makes[2], taken[2]),
    },
  };
}

/**
 * Make rates over an athlete's whole result history, overall and by attempt
 * number, per lift.
 *
 * Attempts are classified by `wasAttemptTaken` / `wasAttemptMade`, the
 * convention every make rate in the app shares: an untaken attempt (`null`,
 * `undefined` or `0`) is neither a make nor a miss. The screen used to count
 * by hand with `attempt !== null && attempt !== 0`, which scored a missing
 * (`undefined`) attempt as a miss.
 */
export function calculateAthleteMakeRates(
  results: readonly SupabaseLiftResult[],
): AthleteMakeRates {
  const snatch = rateLift(results.map((r) => [r.snatch1, r.snatch2, r.snatch3]));
  const cj = rateLift(results.map((r) => [r.cj1, r.cj2, r.cj3]));
  return {
    snatchMakeRate: snatch.overall.rate,
    cjMakeRate: cj.overall.rate,
    totalSnatchAttempts: snatch.overall.total,
    totalCJAttempts: cj.overall.total,
    snatchAttemptRates: snatch.byAttempt,
    cjAttemptRates: cj.byAttempt,
  };
}
