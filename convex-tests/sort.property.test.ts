import * as fc from 'fast-check';

import { hostileStringArb } from '@/test-support/arbitraries';

import { compareBytes, compareCollated, sortByWeightClass } from '../convex/lib/sort';

/** Weight classes as published, the forms the sort key reads, and junk. */
const weightClassArb = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom('55', '61', '87', '109', '+109', '109+', '87+', '87kg', '87+kg', '87kgkg', '87++', '-1', '0', '-0', '0087', '87.5', '', '+', 'kg', 'Open') },
  {
    weight: 3,
    arbitrary: fc
      .tuple(
        fc.constantFrom('', '+', '-'),
        fc.integer({ min: 0, max: 400 }),
        fc.constantFrom('', '+', 'kg', '+kg', 'kg+', '++'),
      )
      .map(([sign, n, suffix]) => `${sign}${n}${suffix}`),
  },
  { weight: 1, arbitrary: fc.constantFrom('2147483647', '2147483648', '-2147483648', '-2147483649', '9007199254740993') },
  { weight: 1, arbitrary: hostileStringArb },
);

type Item = { id: number; weightClass: string };
const itemsArb = fc
  .array(weightClassArb, { maxLength: 25 })
  .map((classes): Item[] => classes.map((weightClass, id) => ({ id, weightClass })));

const sortClasses = (classes: string[]) => sortByWeightClass(classes, (c) => c);

/** The order sortByWeightClass gives two classes: -1, 0 (a tie, left in input order) or 1. */
function order(a: string, b: string): number {
  const ab = sortByWeightClass([{ c: a, i: 0 }, { c: b, i: 1 }], (x) => x.c);
  const ba = sortByWeightClass([{ c: b, i: 0 }, { c: a, i: 1 }], (x) => x.c);
  const aFirst = ab[0].i === 0;
  const aFirstReversed = ba[0].i === 1;
  if (aFirst && aFirstReversed) return -1;
  if (!aFirst && !aFirstReversed) return 1;
  return 0;
}

describe('sortByWeightClass (property)', () => {
  it('returns a permutation of its input', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const sorted = sortByWeightClass(items, (item) => item.weightClass);
        expect(sorted.map((item) => item.id).sort((a, b) => a - b)).toEqual(items.map((item) => item.id));
      }),
    );
  });

  it('orders by a total preorder: ties are an equivalence, the rest transitive', () => {
    fc.assert(
      fc.property(weightClassArb, weightClassArb, weightClassArb, (a, b, c) => {
        expect(order(a, a)).toBe(0);
        expect(order(a, b) + order(b, a)).toBe(0);
        if (order(a, b) <= 0 && order(b, c) <= 0) expect(order(a, c)).toBeLessThanOrEqual(0);
        if (order(a, b) === 0 && order(b, c) === 0) expect(order(a, c)).toBe(0);
      }),
    );
  });

  it('is sorted, stable, and gives the same classes in the same order whatever the input order', () => {
    fc.assert(
      fc.property(
        itemsArb.chain((items) => fc.tuple(fc.constant(items), fc.shuffledSubarray(items, { minLength: items.length }))),
        ([items, shuffled]) => {
          const sorted = sortByWeightClass(items, (item) => item.weightClass);
          for (let i = 1; i < sorted.length; i++) {
            const o = order(sorted[i - 1].weightClass, sorted[i].weightClass);
            expect(o).toBeLessThanOrEqual(0);
            if (o === 0) expect(sorted[i - 1].id).toBeLessThan(sorted[i].id);
          }
          // Tied classes may be different strings ('87', '87kg'), so compare
          // the sequence of tie classes, not the strings.
          const resorted = sortByWeightClass(shuffled, (item) => item.weightClass);
          for (let i = 0; i < sorted.length; i++) {
            expect(order(sorted[i].weightClass, resorted[i].weightClass)).toBe(0);
          }
        },
      ),
    );
  });

  it('puts numbers in numeric order, the + class right after its number, and non-numbers last', () => {
    // A class with no digit at all can never parse as a number.
    const junkArb = fc.oneof(fc.string(), hostileStringArb).filter((text) => !/\d/.test(text));
    fc.assert(
      fc.property(fc.integer({ min: -500, max: 500 }), fc.integer({ min: -500, max: 500 }), junkArb, (n, m, junk) => {
        fc.pre(n < m);
        expect(order(`${n}`, `${m}`)).toBe(-1);
        expect(order(`${n}`, `${n}+`)).toBe(-1);
        expect(order(`${n}+`, `${m}`)).toBe(-1);
        expect(order(`${n}kg`, `${n}`)).toBe(0);
        expect(order(`${m}+`, junk)).toBe(-1);
      }),
    );
  });

  it('example: published classes, a leading + reads as a sign', () => {
    expect(sortClasses(['109+', 'Open', '+109', '87', '109', '87+', '61kg'])).toEqual(['61kg', '87', '87+', '+109', '109', '109+', 'Open']);
  });

  // Fixed: the bound accepted 2147483648, which `str::parse::<i32>` rejects,
  // so the class sorted as a number instead of last as the Rust API did.
  it('example (shrunk): only i32 values are numbers, as in the Rust API', () => {
    expect(order('2147483647', 'Open')).toBe(-1);
    expect(order('-2147483648', '0')).toBe(-1);
    expect(order('2147483648', 'Open')).toBe(0);
    expect(order('-2147483649', 'Open')).toBe(0);
  });
});

/** Characters where collation and code-unit order disagree, or collation ties. */
const collationTextArb = fc.string({
  unit: fc.constantFrom('a', 'A', 'á', 'b', 'B', 'z', 'ß', 's', 'æ', 'e', '-', ' ', "'", '\u0000', '́', '\uD800', '\uDC00', '😀', 'ǅ', '1', '١', 'Ж'),
  maxLength: 5,
});
const anyTextArb = fc.oneof(collationTextArb, hostileStringArb);

describe('compareCollated / compareBytes (property)', () => {
  for (const [name, compare] of [
    ['compareCollated', compareCollated],
    ['compareBytes', compareBytes],
  ] as const) {
    it(`${name} is a total order: zero only for equal strings, antisymmetric`, () => {
      fc.assert(
        fc.property(anyTextArb, anyTextArb, (a, b) => {
          expect(compare(a, a)).toBe(0);
          expect(Math.sign(compare(a, b)) + Math.sign(compare(b, a))).toBe(0);
          if (a !== b) expect(compare(a, b)).not.toBe(0);
        }),
      );
    });

    it(`${name} sorts to one order whatever the input order, every pair in order`, () => {
      fc.assert(
        fc.property(
          fc
            .array(anyTextArb, { maxLength: 20 })
            .chain((texts) => fc.tuple(fc.constant(texts), fc.shuffledSubarray(texts, { minLength: texts.length }))),
          ([texts, shuffled]) => {
            const sorted = [...texts].sort(compare);
            expect([...shuffled].sort(compare)).toEqual(sorted);
            for (let i = 0; i < sorted.length; i++) {
              for (let j = i + 1; j < sorted.length; j++) expect(compare(sorted[i], sorted[j])).toBeLessThanOrEqual(0);
            }
          },
        ),
      );
    });
  }

  it('example: collation ties break on code units, so equal-looking names keep one order', () => {
    expect(compareCollated('a', 'a\u0000')).toBe(-1);
    expect(compareCollated('a\u0000', 'a')).toBe(1);
  });
});
