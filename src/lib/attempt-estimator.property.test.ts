import * as fc from 'fast-check';

import type { LiftResult, SupabaseLiftResult } from '@/data/types/athletes';
import { calculateEstimates, generateAthleteNotes, type AthleteAttemptEstimate } from '@/lib/attempt-estimator';
import { addCalendarDays } from '@/test-support/time-arbitraries';

/** A fixed clock, so the two-year history cutoff is the same for every case. */
const NOW = new Date('2026-10-12T12:00:00Z');
const TODAY = '2026-10-12';
const NAMES = ['Ada Lane', 'Bo Kim', 'Cy Ortiz', 'Di Park'];

/** A taken lift is a non-zero number of kg; negative is a miss. */
const attemptArb = fc.oneof(
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constant(0) },
  { weight: 4, arbitrary: fc.integer({ min: 20, max: 250 }) },
  { weight: 2, arbitrary: fc.integer({ min: -250, max: -20 }) },
);
const bestArb = fc.oneof(fc.constant(null), fc.constant(0), fc.integer({ min: 20, max: 250 }));

/** A result row: name spelled with stray case and spaces, dated within three years. */
const resultArb: fc.Arbitrary<SupabaseLiftResult> = fc
  .record({
    name: fc.tuple(fc.constantFrom(...NAMES, 'Not Entered'), fc.boolean(), fc.boolean()).map(
      ([name, upper, padded]) => {
        const spelled = upper ? name.toUpperCase() : name;
        return padded ? `  ${spelled.replace(' ', '   ')} ` : spelled;
      },
    ),
    date: fc
      .tuple(fc.integer({ min: 0, max: 3 * 366 }), fc.constantFrom('', 'T00:00:00', 'T12:00:00Z'))
      .map(([daysAgo, suffix]) => `${addCalendarDays(TODAY, -daysAgo)}${suffix}`),
    snatch1: attemptArb,
    snatch2: attemptArb,
    snatch3: attemptArb,
    snatch_best: bestArb,
    cj1: attemptArb,
    cj2: attemptArb,
    cj3: attemptArb,
    cj_best: bestArb,
  })
  .map((row) => ({ id: 0, event_id: 'e', meet: 'M', age: 30, body_weight: 81, total: null, ...row }));

const athletesArb: fc.Arbitrary<LiftResult[]> = fc
  .uniqueArray(fc.constantFrom(...NAMES), { minLength: 1, maxLength: NAMES.length })
  .chain((names) =>
    fc.tuple(...names.map(() => fc.oneof(fc.integer({ min: -10, max: 500 }), fc.constant(Number.NaN)))).map(
      (totals) =>
        names.map(
          (name, index): LiftResult => ({
            memberId: `m-${name}`,
            name,
            age: 30,
            club: 'Club',
            gender: 'F',
            weightClass: '64',
            entryTotal: totals[index],
            adaptive: false,
          }),
        ),
    ),
  );

function shuffledArb<T>(items: T[]): fc.Arbitrary<T[]> {
  return fc.shuffledSubarray(items, { minLength: items.length, maxLength: items.length });
}

const inputArb = fc
  .record({ athletes: athletesArb, results: fc.array(resultArb, { maxLength: 12 }) })
  .chain(({ athletes, results }) =>
    fc
      .record({ athletes: shuffledArb(athletes), results: shuffledArb(results) })
      .map((shuffled) => ({ athletes, results, shuffled })),
  );

function expectSaneKg(values: number[]): void {
  expect(values.length === 0 || values.length === 3).toBe(true);
  for (const kg of values) {
    expect(Number.isInteger(kg)).toBe(true);
    expect(kg).toBeGreaterThanOrEqual(0);
  }
  for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
}

/** An estimate without the attempts-out counts (see the athlete-order property). */
function withoutAttemptsOut(estimate: AthleteAttemptEstimate) {
  return { ...estimate, snatchAttemptsOut: undefined, cjAttemptsOut: undefined };
}

describe('calculateEstimates', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('estimates whole, non-negative, non-decreasing kg and bounded rates, never NaN', () => {
    fc.assert(
      fc.property(inputArb, ({ athletes, results }) => {
        const estimates = calculateEstimates(athletes, results);
        expect(estimates.map((estimate) => estimate.athleteName)).toEqual(athletes.map((athlete) => athlete.name));
        for (const estimate of estimates) {
          expectSaneKg(estimate.snatchEstimates);
          expectSaneKg(estimate.cjEstimates);
          for (const rate of [estimate.snatchMakeRate, estimate.cjMakeRate]) {
            expect(rate).toBeGreaterThanOrEqual(0);
            expect(rate).toBeLessThanOrEqual(1);
          }
          for (const out of [estimate.snatchAttemptsOut, estimate.cjAttemptsOut]) {
            expect(Number.isInteger(out) && out >= 0).toBe(true);
          }
          const notes = generateAthleteNotes(estimate);
          expect(notes.length).toBeGreaterThan(0);
          expect(notes).not.toMatch(/NaN|undefined|Infinity/);
        }
      }),
    );
  });

  it('is deterministic and ignores the order of the result rows', () => {
    fc.assert(
      fc.property(inputArb, ({ athletes, results, shuffled }) => {
        const estimates = calculateEstimates(athletes, results);
        expect(calculateEstimates(athletes, results)).toEqual(estimates);
        expect(calculateEstimates(athletes, shuffled.results)).toEqual(estimates);
      }),
    );
  });

  it("gives each athlete the same estimate whatever the start list's order", () => {
    fc.assert(
      fc.property(inputArb, ({ athletes, results, shuffled }) => {
        const byId = (list: AthleteAttemptEstimate[]) =>
          Object.fromEntries(list.map((estimate) => [estimate.id, withoutAttemptsOut(estimate)]));
        // Attempts out are left out: openers of equal weight keep start-list
        // order (a stable sort), and "follows themselves" counts depend on
        // that adjacency, so they legitimately move with the list's order.
        expect(byId(calculateEstimates(shuffled.athletes, results))).toEqual(
          byId(calculateEstimates(athletes, results)),
        );
      }),
    );
  });
});
