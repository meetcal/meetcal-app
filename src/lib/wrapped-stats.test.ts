import type { ApiWrappedStats } from '@/lib/api/meetcal-api';
import { buildWrappedShareText, formatImprovement, NO_FAVORITE_ATTEMPT, toWrappedStats } from '@/lib/wrapped-stats';

// The scoring rules themselves are tested on the server (`convex-tests/wrapped.test.ts`).

const serverStats = (overrides: Partial<ApiWrappedStats> = {}): ApiWrappedStats => ({
  totalWeightLifted: 1200,
  totalMeets: 3,
  makePercentage: 75,
  bestSnatch: 100,
  bestCleanJerk: 125,
  bestTotal: 225,
  averageTotal: 215,
  topMeet: 'Spring Open',
  improvementFromFirst: 10,
  longestMakeStreak: 5,
  favoriteAttempt: 2,
  yearRank: 'Meet Regular',
  ...overrides,
});

describe('toWrappedStats', () => {
  it("shows the server's stats in the screen's terms", () => {
    expect(toWrappedStats(serverStats())).toEqual({
      totalWeightLifted: 1200,
      totalMeets: 3,
      makePercentage: 75,
      bestSnatch: 100,
      bestCleanJerk: 125,
      bestTotal: 225,
      averageTotal: 215,
      topMeet: 'Spring Open',
      improvementFromFirst: 10,
      consecutiveMakes: 5,
      favoriteAttempt: '2nd',
      yearRank: 'Meet Regular',
    });
  });

  it('words a year with no made attempt, no total and fewer than two meets', () => {
    const stats = toWrappedStats(serverStats({ favoriteAttempt: null, topMeet: null, improvementFromFirst: null }));
    expect(stats.favoriteAttempt).toBe(NO_FAVORITE_ATTEMPT);
    expect(stats.topMeet).toBe('N/A');
    expect(stats.improvementFromFirst).toBeNull();
  });
});

describe('formatImprovement', () => {
  it('signs a change, calls no change Steady, and hides an unknown one', () => {
    expect(formatImprovement(12)).toBe('+12kg');
    expect(formatImprovement(-5)).toBe('-5kg');
    expect(formatImprovement(0)).toBe('Steady');
    expect(formatImprovement(null)).toBeNull();
  });
});

describe('buildWrappedShareText', () => {
  it('labels the bests as the year\'s, never as PRs', () => {
    const stats = toWrappedStats(serverStats({ bestSnatch: 100, bestCleanJerk: 120, bestTotal: 220 }));
    const text = buildWrappedShareText(stats, 2025);

    expect(text).toContain('My 2025 Weightlifting Wrapped!');
    expect(text).toContain('Best Snatch of 2025: 100kg');
    expect(text).toContain('Best Clean & Jerk of 2025: 120kg');
    expect(text).toContain('Best Total of 2025: 220kg');
    expect(text).not.toMatch(/\bPR\b/);
  });
});
