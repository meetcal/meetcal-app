import type { SupabaseLiftResult } from '@/data/types/athletes';
import {
  buildWrappedShareText,
  calculateWrappedStats,
  formatImprovement,
  NO_FAVORITE_ATTEMPT,
} from '@/lib/wrapped-stats';

function row(overrides: Partial<SupabaseLiftResult> = {}): SupabaseLiftResult {
  return {
    id: 1,
    event_id: 'e1',
    meet: 'Test Open',
    date: '2026-03-01',
    name: 'Test Athlete',
    age: 25,
    body_weight: 81,
    snatch1: null,
    snatch2: null,
    snatch3: null,
    snatch_best: null,
    cj1: null,
    cj2: null,
    cj3: null,
    cj_best: null,
    total: null,
    ...overrides,
  };
}

describe('calculateWrappedStats', () => {
  it('counts each miss once, so three makes and three misses is 50%', () => {
    // Regression: `totalAttempts` used to be incremented both inside the
    // miss branch and again unconditionally below it, so misses were double
    // counted and a genuine 50% rendered as 33%.
    const stats = calculateWrappedStats([
      row({
        snatch1: 100,
        snatch2: 105,
        snatch3: -110,
        cj1: 120,
        cj2: -125,
        cj3: -125,
      }),
    ]);

    expect(stats.makePercentage).toBe(50);
  });

  it('is 100% when every taken attempt was made', () => {
    const stats = calculateWrappedStats([
      row({ snatch1: 100, snatch2: 105, cj1: 120, cj2: 125 }),
    ]);

    expect(stats.makePercentage).toBe(100);
    expect(stats.yearRank).toBe('Consistency King');
  });

  it('is 0% when every taken attempt was missed', () => {
    const stats = calculateWrappedStats([
      row({ snatch1: -100, snatch2: -100, snatch3: -100 }),
    ]);

    expect(stats.makePercentage).toBe(0);
    expect(stats.totalWeightLifted).toBe(0);
  });

  it('ignores untaken attempts (null / 0) in the denominator', () => {
    const withGaps = calculateWrappedStats([
      row({ snatch1: 100, snatch2: -105, snatch3: 0, cj1: null, cj2: 0, cj3: null }),
    ]);

    expect(withGaps.makePercentage).toBe(50);
  });

  it('reports no attempts as 0% rather than NaN', () => {
    expect(calculateWrappedStats([row()]).makePercentage).toBe(0);
    expect(calculateWrappedStats([]).makePercentage).toBe(0);
  });

  it('crosses the ELITE threshold at the real make rate', () => {
    // 8 makes / 10 taken attempts = 80%, the ELITE cutoff in the UI. Under the
    // double count this was 8/12 = 66.7% and rendered SOLID.
    const stats = calculateWrappedStats([
      row({ snatch1: 100, snatch2: 105, snatch3: 110, cj1: 120, cj2: 125, cj3: 130 }),
      row({ snatch1: 100, snatch2: -105, snatch3: 110, cj1: -120 }),
    ]);

    expect(stats.makePercentage).toBeCloseTo(80, 5);
  });

  it('sums only made attempts into total weight lifted', () => {
    const stats = calculateWrappedStats([
      row({ snatch1: 100, snatch2: -105, cj1: 120 }),
    ]);

    expect(stats.totalWeightLifted).toBe(220);
  });

  it('tracks the longest make streak and breaks it on a miss', () => {
    const stats = calculateWrappedStats([
      row({ snatch1: 100, snatch2: 105, snatch3: -110, cj1: 120, cj2: 125, cj3: 130 }),
    ]);

    expect(stats.consecutiveMakes).toBe(3);
  });

  it('does not break a make streak on an untaken attempt', () => {
    const stats = calculateWrappedStats([
      row({ snatch1: 100, snatch2: 105, snatch3: null, cj1: 120, cj2: 125 }),
    ]);

    expect(stats.consecutiveMakes).toBe(4);
  });

  it('picks the meet with the highest total and counts distinct meets', () => {
    const stats = calculateWrappedStats([
      row({ meet: 'Local Open', total: 200 }),
      row({ meet: 'Nationals', total: 240 }),
      row({ meet: 'Nationals', total: 230 }),
    ]);

    expect(stats.topMeet).toBe('Nationals');
    expect(stats.totalMeets).toBe(2);
    expect(stats.bestTotal).toBe(240);
    expect(stats.averageTotal).toBeCloseTo(223.3333, 3);
  });

  it('measures improvement from the first row to the last', () => {
    const stats = calculateWrappedStats([
      row({ meet: 'Winter Open', date: '2026-01-10', total: 200 }),
      row({ meet: 'Summer Open', date: '2026-06-10', total: 225 }),
    ]);

    expect(stats.improvementFromFirst).toBe(25);
  });

  it('has no improvement when every total comes from one meet', () => {
    // One meet can carry two rows (the same lift listed in two age
    // divisions). Wrapped says one meet, so it must not show "+10kg".
    const stats = calculateWrappedStats([
      row({ meet: 'Local Open', total: 200 }),
      row({ meet: 'Local Open', total: 210 }),
    ]);

    expect(stats.totalMeets).toBe(1);
    expect(stats.improvementFromFirst).toBeNull();
  });

  it("compares each meet's best total when a meet has several rows", () => {
    const stats = calculateWrappedStats([
      row({ meet: 'Local Open', date: '2026-01-10', total: 200 }),
      row({ meet: 'Local Open', date: '2026-01-10', total: 205 }),
      row({ meet: 'Nationals', date: '2026-06-10', total: 230 }),
      row({ meet: 'Nationals', date: '2026-06-10', total: 220 }),
    ]);

    expect(stats.improvementFromFirst).toBe(25);
  });

  it('ignores a bomb-out at the end of the year', () => {
    // A 0 / missing total used to be read as the last total: "-200kg".
    const stats = calculateWrappedStats([
      row({ meet: 'Winter Open', date: '2026-01-10', total: 200 }),
      row({ meet: 'Spring Open', date: '2026-04-10', total: 210 }),
      row({ meet: 'Fall Open', date: '2026-09-10', total: 0 }),
    ]);

    expect(stats.improvementFromFirst).toBe(10);
  });

  it('ignores a bomb-out at the start of the year', () => {
    const stats = calculateWrappedStats([
      row({ meet: 'Winter Open', date: '2026-01-10', total: null }),
      row({ meet: 'Spring Open', date: '2026-04-10', total: 200 }),
      row({ meet: 'Fall Open', date: '2026-09-10', total: 195 }),
    ]);

    expect(stats.improvementFromFirst).toBe(-5);
  });

  it('has no improvement with fewer than two meets that have a total', () => {
    expect(
      calculateWrappedStats([
        row({ meet: 'Winter Open', date: '2026-01-10', total: 0 }),
        row({ meet: 'Summer Open', date: '2026-06-10', total: 200 }),
      ]).improvementFromFirst,
    ).toBeNull();
    expect(calculateWrappedStats([row({ total: 200 })]).improvementFromFirst).toBeNull();
    expect(calculateWrappedStats([]).improvementFromFirst).toBeNull();
  });

  it('names the attempt number made most often', () => {
    const stats = calculateWrappedStats([
      row({ snatch2: 105, cj2: 125, snatch1: -100, cj1: -120 }),
    ]);

    expect(stats.favoriteAttempt).toBe('2nd');
  });

  it('breaks a favourite-attempt tie toward the earlier attempt, as the website does', () => {
    const stats = calculateWrappedStats([
      row({ meet: 'Winter Open', snatch1: 100, snatch2: 105, snatch3: -110, cj1: 120, cj2: -125, cj3: -125 }),
      row({ meet: 'Spring Open', date: '2026-04-01', snatch1: 100, snatch2: -105, snatch3: -105, cj1: 120, cj2: 125, cj3: -130 }),
    ]);

    // 1st: 4 makes, 2nd: 2 makes.
    expect(stats.favoriteAttempt).toBe('1st');
    expect(
      calculateWrappedStats([row({ snatch1: 100, snatch2: 105, cj1: -120, cj2: -125 })]).favoriteAttempt,
    ).toBe('1st');
    expect(
      calculateWrappedStats([row({ snatch2: 105, snatch3: 110, cj2: -125, cj3: -130 })]).favoriteAttempt,
    ).toBe('2nd');
  });

  it('has no favourite attempt when nothing was made', () => {
    const stats = calculateWrappedStats([row({ snatch1: -100, snatch2: -100, snatch3: -100 })]);

    expect(stats.favoriteAttempt).toBe(NO_FAVORITE_ATTEMPT);
  });

  it('falls back to N/A when no row carries a total', () => {
    const stats = calculateWrappedStats([row({ snatch1: 100 })]);

    expect(stats.topMeet).toBe('N/A');
    expect(stats.averageTotal).toBe(0);
  });

  it('counts a meet listed under two age divisions once', () => {
    // Regression (#305): one 6-for-6 lift listed under Junior and Senior used
    // to double the kilos and the streak, and three meets could reach the
    // five-row "Meet Regular" rank.
    const lift = {
      date: '2026-03-01',
      snatch1: 100,
      snatch2: 105,
      snatch3: 110,
      snatch_best: 110,
      cj1: 120,
      cj2: 125,
      cj3: 130,
      cj_best: 130,
      total: 240,
    };
    const stats = calculateWrappedStats([
      row({ ...lift, meet: 'State Open', age: 'Junior' }),
      row({ ...lift, meet: 'State Open', age: 'Senior' }),
    ]);

    expect(stats.totalWeightLifted).toBe(690);
    expect(stats.consecutiveMakes).toBe(6);
    expect(stats.makePercentage).toBe(100);
    expect(stats.averageTotal).toBe(240);
    expect(stats.totalMeets).toBe(1);
  });

  it('counts one lift filed under two meet names on one date once', () => {
    // The same lift returned as both the Youth and the Junior Championships.
    const lift = { date: '2026-06-28', snatch1: 61, snatch2: -64, snatch3: -64, cj1: 81, cj2: -84, cj3: -87, total: 142 };
    const stats = calculateWrappedStats([
      row({ ...lift, meet: 'National Youth Championships' }),
      row({ ...lift, meet: 'National Junior Championships' }),
    ]);

    expect(stats.totalWeightLifted).toBe(142);
    expect(stats.makePercentage).toBeCloseTo(100 / 3, 5);
    expect(stats.totalMeets).toBe(1);
    expect(stats.improvementFromFirst).toBeNull();
  });

  it('counts one meet listed under two dates once', () => {
    const lift = { meet: 'Summer Slam', snatch1: 60, cj1: 80, total: 140 };
    const stats = calculateWrappedStats([
      row({ ...lift, date: '2026-05-16' }),
      row({ ...lift, date: '2026-05-19' }),
    ]);

    expect(stats.totalWeightLifted).toBe(140);
    expect(stats.averageTotal).toBe(140);
  });

  it('keeps two different lifts on one date, and the same numbers at two meets', () => {
    const stats = calculateWrappedStats([
      // Same day, different numbers: not the same lift.
      row({ meet: 'A Open', date: '2026-03-01', snatch1: 100, total: 220 }),
      row({ meet: 'B Open', date: '2026-03-01', snatch1: 101, total: 221 }),
      // Same numbers, different meet and date: two lifts that happen to match.
      row({ meet: 'C Open', date: '2026-08-01', snatch1: 100, total: 220 }),
    ]);

    expect(stats.totalWeightLifted).toBe(301);
    expect(stats.totalMeets).toBe(3);
  });

  it('keeps the same numbers at two editions of a recurring meet', () => {
    // A monthly "Local Open" lifted the same way twice is two lifts.
    const lift = { meet: 'Local Open', snatch1: 45, cj1: 55, total: 100 };
    const stats = calculateWrappedStats([
      row({ ...lift, date: '2026-04-11' }),
      row({ ...lift, date: '2026-05-09' }),
    ]);

    expect(stats.totalWeightLifted).toBe(200);
    expect(stats.makePercentage).toBe(100);
  });

  it('keeps rows with an unreadable date apart from a same-named meet', () => {
    const lift = { meet: 'Local Open', snatch1: 45, cj1: 55, total: 100 };
    const stats = calculateWrappedStats([
      row({ ...lift, date: '2026-04-11' }),
      row({ ...lift, date: '' }),
    ]);

    expect(stats.totalWeightLifted).toBe(200);
  });

  it('needs five distinct lifts, not five rows, to rank Meet Regular', () => {
    const lift = { snatch1: 50, snatch2: -55, cj1: 70, cj2: -75, total: 120 };
    const duplicated = [1, 2, 3].flatMap((month) => [
      row({ ...lift, meet: `Meet ${month}`, date: `2026-0${month}-01`, age: 'Junior' }),
      row({ ...lift, meet: `Meet ${month}`, date: `2026-0${month}-01`, age: 'Senior' }),
    ]);
    expect(calculateWrappedStats(duplicated).yearRank).toBe('Rising Star');

    const distinct = [1, 2, 3, 4, 5].map((month) =>
      row({ ...lift, meet: `Meet ${month}`, date: `2026-0${month}-01` }),
    );
    expect(calculateWrappedStats(distinct).yearRank).toBe('Meet Regular');
  });

  it('ranks a heavy but inconsistent year as Heavy Hitter', () => {
    const stats = calculateWrappedStats([
      row({ snatch1: 140, snatch2: -145, cj1: 170, cj2: -175, total: 310 }),
    ]);

    expect(stats.makePercentage).toBe(50);
    expect(stats.yearRank).toBe('Heavy Hitter');
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
    const stats = calculateWrappedStats([
      row({ snatch1: 100, snatch_best: 100, cj1: 120, cj_best: 120, total: 220 }),
    ]);
    const text = buildWrappedShareText(stats, 2025);

    expect(text).toContain('My 2025 Weightlifting Wrapped!');
    expect(text).toContain('Best Snatch of 2025: 100kg');
    expect(text).toContain('Best Clean & Jerk of 2025: 120kg');
    expect(text).toContain('Best Total of 2025: 220kg');
    expect(text).not.toMatch(/\bPR\b/);
  });
});
