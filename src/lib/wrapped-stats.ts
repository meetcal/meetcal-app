import type { ApiWrappedStats } from '@/lib/api/meetcal-api';
import type { WrappedStats } from '@/types/wrapped';

/**
 * How the Weightlifting Wrapped screen shows a year. The year is scored on
 * the server (`results:wrapped`, `convex/lib/wrapped.ts`), so Wrapped stays
 * free without the app reading the results behind it; this maps its answer
 * into the screen's terms and words it for sharing.
 */

/** `favoriteAttempt` for a year with no made attempt. */
export const NO_FAVORITE_ATTEMPT = '—';

const ORDINALS = { 1: '1st', 2: '2nd', 3: '3rd' } as const;

/** The server's stats as the screen shows them. */
export function toWrappedStats(stats: ApiWrappedStats): WrappedStats {
  return {
    totalWeightLifted: stats.totalWeightLifted,
    totalMeets: stats.totalMeets,
    makePercentage: stats.makePercentage,
    bestSnatch: stats.bestSnatch,
    bestCleanJerk: stats.bestCleanJerk,
    bestTotal: stats.bestTotal,
    averageTotal: stats.averageTotal,
    topMeet: stats.topMeet ?? 'N/A',
    improvementFromFirst: stats.improvementFromFirst,
    consecutiveMakes: stats.longestMakeStreak,
    favoriteAttempt: stats.favoriteAttempt === null ? NO_FAVORITE_ATTEMPT : ORDINALS[stats.favoriteAttempt],
    yearRank: stats.yearRank,
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
