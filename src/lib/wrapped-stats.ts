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

function meetKey(meet: string): string {
  return meet.trim().toLowerCase();
}

/**
 * The most days apart one meet's rows can be filed: a national championship
 * runs about ten days. Further apart, a meet with the same name is another
 * edition (a monthly local open), and its rows are separate lifts.
 */
export const MEET_EDITION_SPAN_DAYS = 10;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Days since the epoch for a `YYYY-MM-DD` calendar date, or null. */
function calendarDay(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / MS_PER_DAY;
}

/** Two rows' dates are within one meet's span. Unparseable dates never are. */
function withinOneEdition(a: string, b: string): boolean {
  const dayA = calendarDay(a);
  const dayB = calendarDay(b);
  if (dayA === null || dayB === null) return false;
  return Math.abs(dayA - dayB) <= MEET_EDITION_SPAN_DAYS;
}

/**
 * The rows that are distinct lifts, in their original order.
 *
 * One lift can come back as several rows: the same meet listed under two age
 * divisions, one meet filed under two dates, or one lift filed under two meet
 * names (Youth and Junior Championships) on one date. Scoring each row would
 * count that lift's kilos, attempts and streak twice.
 *
 * The rule: two rows are the same lift when all six attempts and the total
 * are equal and they share the date, or share the meet name (trimmed, any
 * case) within `MEET_EDITION_SPAN_DAYS`. The first row is kept. Same numbers
 * at a different meet on a different date stay two lifts, as do two editions
 * of a recurring meet and two different lifts on one date.
 */
export function distinctLifts(data: readonly SupabaseLiftResult[]): SupabaseLiftResult[] {
  const keptBySignature = new Map<string, SupabaseLiftResult[]>();
  const kept: SupabaseLiftResult[] = [];
  for (const result of data) {
    const signature = JSON.stringify([...attemptsOf(result), result.total]);
    const sameNumbers = keptBySignature.get(signature) ?? [];
    const isDuplicate = sameNumbers.some(
      (other) =>
        other.date === result.date ||
        (meetKey(other.meet) === meetKey(result.meet) &&
          withinOneEdition(other.date, result.date)),
    );
    if (isDuplicate) continue;
    sameNumbers.push(result);
    keptBySignature.set(signature, sameNumbers);
    kept.push(result);
  }
  return kept;
}

/**
 * `rows` is expected sorted oldest-first; `improvementFromFirst` relies on it.
 * Rows that are one lift listed twice are scored once (`distinctLifts`).
 */
export function calculateWrappedStats(rows: readonly SupabaseLiftResult[]): WrappedStats {
  const data = distinctLifts(rows);
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
  // Each meet's best total, keyed by meet name like `totalMeets`, in the
  // order the meets first appear (oldest first). A Map, not an object, so a
  // numeric-looking meet name cannot jump the order.
  const meetTotals = new Map<string, number>();

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
      meetTotals.set(result.meet, Math.max(meetTotals.get(result.meet) ?? 0, result.total));
    }
  }

  const makePercentage =
    totalAttempts > 0 ? (successfulAttempts / totalAttempts) * 100 : 0;
  const averageTotal = validTotals > 0 ? totalSum / validTotals : 0;
  const meetNames = [...meetTotals.keys()];
  const topMeet = meetNames.reduce(
    (a, b) => ((meetTotals.get(a) ?? 0) > (meetTotals.get(b) ?? 0) ? a : b),
    meetNames[0] || 'N/A',
  );

  // First to last meet with a total, one total per meet (its best). A
  // bomb-out (no total, or 0) is not a data point: counting one as 0 turned a
  // 200kg lifter's year into "-200kg" (or "+200kg" when the bomb-out came
  // first). Two rows from one meet are not progress either: one meet has
  // nothing to compare.
  const totals = [...meetTotals.values()].filter((total) => total > 0);
  const improvement =
    totals.length >= 2 ? totals[totals.length - 1] - totals[0] : null;

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

/**
 * The improvement stat as shown: "+12kg", "-5kg", "Steady" for no change, or
 * `null` when the year has fewer than two meets with a total and there is
 * nothing to compare.
 */
export function formatImprovement(improvement: number | null): string | null {
  if (improvement === null) return null;
  if (improvement > 0) return `+${improvement}kg`;
  if (improvement < 0) return `${improvement}kg`;
  return 'Steady';
}

/**
 * The plain-text Wrapped, shared when the image share fails.
 *
 * The bests are the best of the selected calendar year, not lifetime records,
 * so they are labelled as such: a down year must not share "PRs" that aren't.
 */
export function buildWrappedShareText(stats: WrappedStats, year: number): string {
  return [
    `My ${year} Weightlifting Wrapped!`,
    '',
    `Total Weight Lifted: ${stats.totalWeightLifted.toLocaleString()}kg`,
    `Make Percentage: ${stats.makePercentage.toFixed(1)}%`,
    `Best Total of ${year}: ${stats.bestTotal}kg`,
    `Best Snatch of ${year}: ${stats.bestSnatch}kg`,
    `Best Clean & Jerk of ${year}: ${stats.bestCleanJerk}kg`,
    `Competed in ${stats.totalMeets} meets`,
    `Status: ${stats.yearRank}`,
    '',
    '#WeightliftingWrapped',
  ].join('\n');
}
