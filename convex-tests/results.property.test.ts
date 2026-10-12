import * as fc from 'fast-check';

import { isoCalendarDateArb } from '@/test-support/arbitraries';

import type { Doc, Id } from '../convex/_generated/dataModel';
import { summaryOf, type Mark } from '../convex/lib/history';
import {
  accumulateBests,
  compareNewestFirst,
  toApiLiftingResult,
  ZERO_BESTS,
  type ApiLiftingResult,
  type YearBests,
} from '../convex/lib/results';

/** A lift in kilograms: made (positive), missed (negative), not taken (0) or not recorded. */
const liftArb = fc.option(
  fc.oneof(fc.integer({ min: -300, max: 300 }), fc.constantFrom(0, -0, 0.5, -0.5)),
  { nil: undefined, freq: 4 },
);

let nextId = 0;

const rowArb: fc.Arbitrary<Doc<'lifting_results'>> = fc
  .record({
    date: isoCalendarDateArb,
    creation: fc.integer({ min: 0, max: 1_000_000 }),
    snatch1: liftArb,
    snatch2: liftArb,
    snatch3: liftArb,
    snatchBest: liftArb,
    cj1: liftArb,
    cj2: liftArb,
    cj3: liftArb,
    cjBest: liftArb,
    total: liftArb,
  })
  .map(({ creation, ...lifts }) => {
    nextId += 1;
    return {
      _id: `lifting_results:${nextId}` as Id<'lifting_results'>,
      _creationTime: creation + nextId / 1e6,
      eventId: `event-${nextId}`,
      meet: 'Meet',
      name: 'Zoë Adams',
      adaptive: false,
      ...lifts,
    };
  });

const rowsArb = fc.array(rowArb, { maxLength: 12 });

const fold = (rows: readonly Doc<'lifting_results'>[]) => rows.reduce(accumulateBests, ZERO_BESTS);
const made = (...lifts: (number | undefined)[]) => lifts.map((lift) => lift ?? 0);

describe('accumulateBests (property)', () => {
  it('is at least the bests so far, every attempt and every recorded best, and is one of them', () => {
    fc.assert(
      fc.property(
        fc.record({ best_snatch: fc.nat(300), best_cj: fc.nat(300), best_total: fc.nat(600) }),
        rowArb,
        (bests: YearBests, row) => {
          const next = accumulateBests(bests, row);
          const snatches = [bests.best_snatch, ...made(row.snatchBest, row.snatch1, row.snatch2, row.snatch3)];
          const cjs = [bests.best_cj, ...made(row.cjBest, row.cj1, row.cj2, row.cj3)];
          const totals = [bests.best_total, ...made(row.total)];
          for (const lift of snatches) expect(next.best_snatch).toBeGreaterThanOrEqual(lift);
          for (const lift of cjs) expect(next.best_cj).toBeGreaterThanOrEqual(lift);
          for (const total of totals) expect(next.best_total).toBeGreaterThanOrEqual(total);
          expect(snatches).toContain(next.best_snatch);
          expect(cjs).toContain(next.best_cj);
          expect(totals).toContain(next.best_total);
        },
      ),
    );
  });

  it('gives the same bests whatever order the rows come in, never below zero', () => {
    fc.assert(
      fc.property(
        rowsArb.chain((rows) => fc.tuple(fc.constant(rows), fc.shuffledSubarray(rows, { minLength: rows.length }))),
        ([rows, shuffled]) => {
          const bests = fold(rows);
          expect(fold(shuffled)).toEqual(bests);
          expect(bests.best_snatch).toBeGreaterThanOrEqual(0);
          expect(bests.best_cj).toBeGreaterThanOrEqual(0);
          expect(bests.best_total).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it('example: missed attempts never win, and no rows is zero', () => {
    expect(fold([])).toEqual(ZERO_BESTS);
    const [row] = fc.sample(rowArb, 1);
    const missed = { ...row, snatch1: -100, snatch2: -100, snatch3: -105, snatchBest: undefined, cj1: -130, cj2: 0, cj3: undefined, cjBest: 0, total: 0 };
    expect(fold([missed])).toEqual(ZERO_BESTS);
  });
});

describe('compareNewestFirst (property)', () => {
  it('is a valid comparator: newest date first, then newest row', () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const sorted = [...rows].sort(compareNewestFirst);
        for (let i = 1; i < sorted.length; i++) {
          const [a, b] = [sorted[i - 1], sorted[i]];
          expect(a.date >= b.date).toBe(true);
          if (a.date === b.date) expect(a._creationTime).toBeGreaterThanOrEqual(b._creationTime);
        }
        for (const a of rows) {
          expect(compareNewestFirst(a, a)).toBe(0);
          for (const b of rows) expect(Math.sign(compareNewestFirst(a, b)) + Math.sign(compareNewestFirst(b, a))).toBe(0);
        }
      }),
    );
  });
});

/** A history as `computeHistory` builds it: rows newest first, in the API shape. */
const historyArb: fc.Arbitrary<ApiLiftingResult[]> = rowsArb.map((rows) =>
  [...rows].sort(compareNewestFirst).map(toApiLiftingResult),
);

describe('summaryOf (property)', () => {
  it('holds the rows of the latest date as latest, and one mark per row in order', () => {
    fc.assert(
      fc.property(historyArb, (history) => {
        const summary = summaryOf(history);
        const marks = JSON.parse(summary.marks) as Mark[];
        const newest = history.reduce((max, row) => (row.date > max ? row.date : max), '');
        // Compared as text: the documents hold JSON, where -0 reads as 0.
        expect(summary.latest).toBe(JSON.stringify(history.filter((row) => row.date === newest)));
        expect(marks.map((mark) => mark[0])).toEqual(history.map((row) => row.date));
        marks.forEach(([, snatch, cj, total], i) => {
          const row = history[i];
          expect(snatch).toBe(Math.max(row.snatch_best, row.snatch1, row.snatch2, row.snatch3) + 0);
          expect(cj).toBe(Math.max(row.cj_best, row.cj1, row.cj2, row.cj3) + 0);
          expect(total).toBe(row.total + 0);
        });
      }),
    );
  });

  // `Mark` documents "the same maxima `results:bests` takes over full rows".
  it('gives the bests accumulateBests gives over the same rows', () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const marks = JSON.parse(summaryOf([...rows].sort(compareNewestFirst).map(toApiLiftingResult)).marks) as Mark[];
        const fromMarks = marks.reduce(
          (bests, [, snatch, cj, total]) => ({
            best_snatch: Math.max(bests.best_snatch, snatch),
            best_cj: Math.max(bests.best_cj, cj),
            best_total: Math.max(bests.best_total, total),
          }),
          ZERO_BESTS,
        );
        expect(fromMarks).toEqual(fold(rows));
      }),
    );
  });

  it('example: an empty history is empty lists', () => {
    expect(summaryOf([])).toEqual({ latest: '[]', marks: '[]' });
  });
});
