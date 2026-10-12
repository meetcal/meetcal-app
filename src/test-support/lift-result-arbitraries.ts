import * as fc from 'fast-check';

import type { SupabaseLiftResult } from '@/data/types/athletes';
import { hostileStringArb } from '@/test-support/arbitraries';

/**
 * Cached lifting-result rows for the offline store's property and chaos
 * tests. Test-only.
 *
 * Every number survives a JSON round trip (no NaN, no infinities, no `-0`,
 * which JSON writes as `0`), so a test can compare what it wrote with what it
 * read using `toEqual`.
 */

const jsonSafeDouble = fc
  .double({ noNaN: true, noDefaultInfinity: true })
  .map((value) => (Object.is(value, -0) ? 0 : value));

const liftArb = fc.option(jsonSafeDouble, { nil: null });

/** Names as the federation spells them, plus the ones a parser trips on. */
export const athleteNameArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 2, arbitrary: fc.string({ unit: 'grapheme', maxLength: 24 }) },
  { weight: 1, arbitrary: fc.constantFrom('Zoë Ørsted', 'Andrés Álvarez', '李娜', "D'Angelo O'Neil", ' Spaced  Name ') },
  { weight: 1, arbitrary: hostileStringArb },
);

export const liftResultArb: fc.Arbitrary<SupabaseLiftResult> = fc.record({
  id: fc.integer(),
  event_id: fc.string({ maxLength: 12 }),
  meet: fc.string({ maxLength: 16 }),
  date: fc.string({ maxLength: 10 }),
  name: athleteNameArb,
  age: fc.oneof(fc.string({ maxLength: 8 }), fc.integer({ min: 0, max: 99 })),
  body_weight: jsonSafeDouble,
  snatch1: liftArb,
  snatch2: liftArb,
  snatch3: liftArb,
  snatch_best: liftArb,
  cj1: liftArb,
  cj2: liftArb,
  cj3: liftArb,
  cj_best: liftArb,
  total: liftArb,
});

/** xorshift32: a cheap, deterministic stream of incompressible text. */
function noise(seed: number): () => string {
  let state = seed | 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0).toString(16).padStart(8, '0');
  };
}

/**
 * `count` rows whose names are random hex, so the deflated blob does not
 * shrink below the store's 180 KB chunk size: 700 rows or more make at least
 * two chunks. Built from a seed rather than generated field by field, which
 * would cost seconds per case.
 */
export function bulkyLiftResults(seed: number, count: number): SupabaseLiftResult[] {
  const next = noise(seed);
  return Array.from({ length: count }, (_, index) => {
    let name = '';
    for (let i = 0; i < 50; i++) name += next();
    return {
      id: index,
      event_id: next(),
      meet: 'Bulk Meet',
      date: '2026-06-20',
      name,
      age: 30,
      body_weight: 88.4,
      snatch1: 100,
      snatch2: null,
      snatch3: -105,
      snatch_best: 100,
      cj1: 120,
      cj2: 125,
      cj3: null,
      cj_best: 125,
      total: 225,
    };
  });
}

/** A meet's results: usually a handful of rows, sometimes none, sometimes several chunks' worth. */
export const liftResultsArb: fc.Arbitrary<SupabaseLiftResult[]> = fc.oneof(
  { weight: 1, arbitrary: fc.constant<SupabaseLiftResult[]>([]) },
  { weight: 8, arbitrary: fc.array(liftResultArb, { minLength: 1, maxLength: 12 }) },
  {
    weight: 1,
    arbitrary: fc
      .record({ seed: fc.integer({ min: 1 }), count: fc.integer({ min: 700, max: 1000 }) })
      .map(({ seed, count }) => bulkyLiftResults(seed, count)),
  },
);
