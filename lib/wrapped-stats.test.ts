import type { SupabaseLiftResult } from '@/data/types/athletes';
import { calculateWrappedStats } from '@/lib/wrapped-stats';

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
      row({ date: '2026-01-10', total: 200 }),
      row({ date: '2026-06-10', total: 225 }),
    ]);

    expect(stats.improvementFromFirst).toBe(25);
  });

  it('names the attempt number made most often', () => {
    const stats = calculateWrappedStats([
      row({ snatch2: 105, cj2: 125, snatch1: -100, cj1: -120 }),
    ]);

    expect(stats.favoriteAttempt).toBe('2nd');
  });

  it('falls back to N/A when no row carries a total', () => {
    const stats = calculateWrappedStats([row({ snatch1: 100 })]);

    expect(stats.topMeet).toBe('N/A');
    expect(stats.averageTotal).toBe(0);
  });

  it('ranks a heavy but inconsistent year as Heavy Hitter', () => {
    const stats = calculateWrappedStats([
      row({ snatch1: 140, snatch2: -145, cj1: 170, cj2: -175, total: 310 }),
    ]);

    expect(stats.makePercentage).toBe(50);
    expect(stats.yearRank).toBe('Heavy Hitter');
  });
});
