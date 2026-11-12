import type { AthleteMeetResult } from '@/data/types/athletes';
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

function rateAttemptSlot(attemptsPerResult: (number | null | undefined)[][], slot: number): AttemptTally {
  let makes = 0;
  let taken = 0;
  for (const attempts of attemptsPerResult) {
    const attempt = attempts[slot];
    if (!wasAttemptTaken(attempt)) continue;
    taken++;
    if (wasAttemptMade(attempt)) makes++;
  }
  return tally(makes, taken);
}

function rateLift(attemptsPerResult: (number | null | undefined)[][]): {
  overall: AttemptTally;
  byAttempt: AttemptRates;
} {
  const attempt1 = rateAttemptSlot(attemptsPerResult, 0);
  const attempt2 = rateAttemptSlot(attemptsPerResult, 1);
  const attempt3 = rateAttemptSlot(attemptsPerResult, 2);
  return {
    overall: tally(
      attempt1.makes + attempt2.makes + attempt3.makes,
      attempt1.total + attempt2.total + attempt3.total,
    ),
    byAttempt: { attempt1, attempt2, attempt3 },
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
  results: readonly AthleteMeetResult[],
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
