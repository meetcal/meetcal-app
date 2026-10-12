import type { SupabaseLiftResult } from '@/data/types/athletes';
import { calculateAthleteMakeRates } from '@/lib/athlete-make-rates';

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

describe('calculateAthleteMakeRates', () => {
  it('scores makes and misses overall and by attempt number', () => {
    const rates = calculateAthleteMakeRates([
      row({ snatch1: 100, snatch2: -105, snatch3: 105, cj1: 120, cj2: 125, cj3: -130 }),
      row({ snatch1: -100, snatch2: 100, snatch3: -104, cj1: 120, cj2: -126, cj3: -126 }),
    ]);

    expect(rates.totalSnatchAttempts).toBe(6);
    expect(rates.snatchMakeRate).toBeCloseTo(50);
    expect(rates.snatchAttemptRates.attempt1).toEqual({ makes: 1, total: 2, rate: 50 });
    expect(rates.snatchAttemptRates.attempt2).toEqual({ makes: 1, total: 2, rate: 50 });
    expect(rates.snatchAttemptRates.attempt3).toEqual({ makes: 1, total: 2, rate: 50 });

    expect(rates.totalCJAttempts).toBe(6);
    expect(rates.cjMakeRate).toBeCloseTo(50);
    expect(rates.cjAttemptRates.attempt1).toEqual({ makes: 2, total: 2, rate: 100 });
    expect(rates.cjAttemptRates.attempt2).toEqual({ makes: 1, total: 2, rate: 50 });
    expect(rates.cjAttemptRates.attempt3).toEqual({ makes: 0, total: 2, rate: 0 });
  });

  it('leaves untaken attempts out of every denominator', () => {
    // `0`, `null` and a missing value are all "not taken". The old hand count
    // (`attempt !== null && attempt !== 0`) scored `undefined` as a miss.
    const rates = calculateAthleteMakeRates([
      row({
        snatch1: 100,
        snatch2: 0,
        snatch3: undefined as unknown as null,
        cj1: 120,
        cj2: null,
      }),
    ]);

    expect(rates.totalSnatchAttempts).toBe(1);
    expect(rates.snatchMakeRate).toBe(100);
    expect(rates.snatchAttemptRates.attempt2).toEqual({ makes: 0, total: 0, rate: 0 });
    expect(rates.snatchAttemptRates.attempt3).toEqual({ makes: 0, total: 0, rate: 0 });
    expect(rates.totalCJAttempts).toBe(1);
    expect(rates.cjMakeRate).toBe(100);
  });

  it('is all zeros for no results', () => {
    const rates = calculateAthleteMakeRates([]);

    expect(rates.snatchMakeRate).toBe(0);
    expect(rates.cjMakeRate).toBe(0);
    expect(rates.totalSnatchAttempts).toBe(0);
    expect(rates.cjAttemptRates.attempt1).toEqual({ makes: 0, total: 0, rate: 0 });
  });
});
