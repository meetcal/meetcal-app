import type { SupabaseLiftResult } from '@/data/types/athletes';
import { wasAttemptMade, wasAttemptTaken } from '@/lib/athletes';
import type { WrappedStats } from '@/types/wrapped';

/**
 * Year-in-review scoring policy for the Weightlifting Wrapped screen.
 *
 * This used to live as an ~80 line closure inside
 * `app/comp-data/weightlifting-wrapped.tsx`, where the numbers it produces —
 * make percentage, the ELITE/SOLID/GROWING tier and the `yearRank` badge —
 * were untestable. Screens orchestrate; policy lives in `lib/`.
 *
 * ## Relationship to `lib/attempt-estimator.ts`'s `calculateMakeRates`
 *
 * The two are deliberately different measurements over the same convention,
 * not two definitions of one number:
 *
 * - Here: **all six attempts** of every result in the selected calendar year,
 *   for one athlete, as a single percentage. It answers "how often did you
 *   make a lift this year".
 * - There: the **opener only** (`snatch1` / `cj1`), split by lift, over the
 *   last two years of history. It answers "how likely is this athlete to make
 *   the opener we are about to estimate", so second and third attempts — which
 *   are chosen *in reaction* to the opener — would bias it.
 *
 * Both share the attempt classification in `lib/athletes.ts`
 * (`wasAttemptTaken` / `wasAttemptMade`), so a miss is a miss in both places.
 */

/** Attempt slots on a result row, in competition order. */
function attemptsOf(result: SupabaseLiftResult): (number | null)[] {
  return [
    result.snatch1,
    result.snatch2,
    result.snatch3,
    result.cj1,
    result.cj2,
    result.cj3,
  ];
}

/** `data` is expected sorted oldest-first; `improvementFromFirst` relies on it. */
export function calculateWrappedStats(data: SupabaseLiftResult[]): WrappedStats {
  let totalWeight = 0;
  let totalAttempts = 0;
  let successfulAttempts = 0;
  let bestSnatch = 0;
  let bestCJ = 0;
  let bestTotal = 0;
  let totalSum = 0;
  let validTotals = 0;
  let consecutiveMakes = 0;
  let maxConsecutiveMakes = 0;
  const meetTotals: Record<string, number> = {};

  for (const result of data) {
    for (const attempt of attemptsOf(result)) {
      // An untaken attempt is neither a make nor a miss: it does not enter the
      // denominator and it does not break a streak.
      if (!wasAttemptTaken(attempt)) continue;

      totalAttempts++;

      if (wasAttemptMade(attempt)) {
        totalWeight += attempt;
        successfulAttempts++;
        consecutiveMakes++;
        maxConsecutiveMakes = Math.max(maxConsecutiveMakes, consecutiveMakes);
      } else {
        consecutiveMakes = 0;
      }
    }

    if (result.snatch_best) bestSnatch = Math.max(bestSnatch, result.snatch_best);
    if (result.cj_best) bestCJ = Math.max(bestCJ, result.cj_best);
    if (result.total) {
      bestTotal = Math.max(bestTotal, result.total);
      totalSum += result.total;
      validTotals++;
      meetTotals[result.meet] = Math.max(meetTotals[result.meet] || 0, result.total);
    }
  }

  const makePercentage =
    totalAttempts > 0 ? (successfulAttempts / totalAttempts) * 100 : 0;
  const averageTotal = validTotals > 0 ? totalSum / validTotals : 0;
  const meetNames = Object.keys(meetTotals);
  const topMeet = meetNames.reduce(
    (a, b) => (meetTotals[a] > meetTotals[b] ? a : b),
    meetNames[0] || 'N/A',
  );

  const firstTotal = data[0]?.total || 0;
  const lastTotal = data[data.length - 1]?.total || 0;
  const improvement = lastTotal - firstTotal;

  const attemptCounts = { '1st': 0, '2nd': 0, '3rd': 0 };
  for (const result of data) {
    if (wasAttemptMade(result.snatch1)) attemptCounts['1st']++;
    if (wasAttemptMade(result.snatch2)) attemptCounts['2nd']++;
    if (wasAttemptMade(result.snatch3)) attemptCounts['3rd']++;
    if (wasAttemptMade(result.cj1)) attemptCounts['1st']++;
    if (wasAttemptMade(result.cj2)) attemptCounts['2nd']++;
    if (wasAttemptMade(result.cj3)) attemptCounts['3rd']++;
  }
  const favoriteAttempt = (
    Object.keys(attemptCounts) as (keyof typeof attemptCounts)[]
  ).reduce((a, b) => (attemptCounts[a] > attemptCounts[b] ? a : b));

  let yearRank = 'Rising Star';
  if (makePercentage >= 90) yearRank = 'Consistency King';
  else if (bestTotal >= 300) yearRank = 'Heavy Hitter';
  else if (data.length >= 5) yearRank = 'Meet Regular';

  return {
    totalWeightLifted: totalWeight,
    totalMeets: new Set(data.map((r) => r.meet)).size,
    makePercentage,
    bestSnatch,
    bestCleanJerk: bestCJ,
    bestTotal,
    averageTotal,
    topMeet,
    improvementFromFirst: improvement,
    consecutiveMakes: maxConsecutiveMakes,
    favoriteAttempt,
    yearRank,
  };
}
