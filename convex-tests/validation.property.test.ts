import * as fc from 'fast-check';

import { hostileStringArb, isoCalendarDateArb } from '@/test-support/arbitraries';

import { isValidIsoDate, MAX_NAME_LEN, MAX_NAME_LIST_LEN, requireNameList } from '../convex/lib/validation';

/**
 * The reference: four, two and two ASCII digits, and the proleptic Gregorian
 * calendar (through `Date`, with `setUTCFullYear` so years 0-99 are not read
 * as 1900-1999) has that day.
 */
function referenceIsValid(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const digits = (count: number) =>
  fc.array(fc.constantFrom(...'0123456789'), { minLength: count, maxLength: count }).map((d) => d.join(''));

/** `YYYY-MM-DD`-shaped strings, mostly out of range: month 00-19, day 00-39, any year. */
const dateShapedArb = fc
  .tuple(
    fc.oneof(digits(4), fc.constantFrom('0000', '1900', '2000', '2024', '2026', '2100', '9999')),
    fc.integer({ min: 0, max: 19 }),
    fc.integer({ min: 0, max: 39 }),
  )
  .map(([year, month, day]) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);

/** A valid date nudged: a trailing newline, a non-ASCII digit, a sign, a space. */
const nearMissArb = fc
  .tuple(isoCalendarDateArb, fc.constantFrom('\n', ' ', '٠', '+', 'T00:00', 'Z'), fc.boolean())
  .map(([date, extra, before]) => (before ? extra + date : date + extra));

const dateInputArb = fc.oneof(dateShapedArb, isoCalendarDateArb, nearMissArb, hostileStringArb);

describe('isValidIsoDate (property)', () => {
  it('agrees with the calendar on every string', () => {
    fc.assert(
      fc.property(dateInputArb, (value) => {
        expect(isValidIsoDate(value)).toBe(referenceIsValid(value));
      }),
    );
  });

  it('accepts every calendar date', () => {
    fc.assert(
      fc.property(isoCalendarDateArb, (date) => {
        expect(isValidIsoDate(date)).toBe(true);
      }),
    );
  });

  it('example: leap days and the days months lack', () => {
    for (const date of ['2024-02-29', '2000-02-29', '0000-02-29', '2026-04-30', '2026-12-31']) {
      expect(isValidIsoDate(date)).toBe(true);
    }
    for (const date of ['2026-02-29', '1900-02-29', '2100-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '2026-01-01\n', '٢٠٢٦-01-01']) {
      expect(isValidIsoDate(date)).toBe(false);
    }
  });
});

const encoder = new TextEncoder();

/** Names of around the byte limit, in characters of one to four UTF-8 bytes. */
const nameArb = fc.oneof(
  { weight: 3, arbitrary: fc.oneof(hostileStringArb, fc.string({ unit: 'grapheme', maxLength: 30 })) },
  {
    weight: 1,
    arbitrary: fc
      .tuple(fc.constantFrom(['a', 1], ['é', 2], ['€', 3], ['😀', 4]) as fc.Arbitrary<[string, number]>, fc.integer({ min: -1, max: 1 }))
      .map(([[char, bytes], delta]) => char.repeat(Math.floor(MAX_NAME_LEN / bytes) + delta)),
  },
);

const nameListArb = fc.oneof(
  fc.array(nameArb, { maxLength: 8 }),
  fc
    .tuple(fc.integer({ min: MAX_NAME_LIST_LEN - 1, max: MAX_NAME_LIST_LEN + 1 }), fc.string({ minLength: 1, maxLength: 5 }))
    .map(([count, name]) => Array.from({ length: count }, () => name)),
);

/** Whether `requireNameList` should refuse: the documented rule. */
function shouldRefuse(names: readonly string[]): boolean {
  return (
    names.length === 0 ||
    names[0].trim() === '' ||
    names.length > MAX_NAME_LIST_LEN ||
    names.some((name) => encoder.encode(name).length > MAX_NAME_LEN)
  );
}

describe('requireNameList (property)', () => {
  it('refuses with a 400 exactly when the first name is blank, the list is too long, or a name is too many bytes', () => {
    fc.assert(
      fc.property(nameListArb, (names) => {
        let thrown: unknown = null;
        try {
          requireNameList(names);
        } catch (error) {
          thrown = error;
        }
        expect(thrown !== null).toBe(shouldRefuse(names));
        if (thrown !== null) expect((thrown as { data?: { status?: number } }).data?.status).toBe(400);
      }),
    );
  });

  it('example: the limits are inclusive, and counted in bytes', () => {
    expect(() => requireNameList(Array.from({ length: MAX_NAME_LIST_LEN }, () => 'a'))).not.toThrow();
    expect(() => requireNameList(Array.from({ length: MAX_NAME_LIST_LEN + 1 }, () => 'a'))).toThrow();
    expect(() => requireNameList(['é'.repeat(MAX_NAME_LEN / 2)])).not.toThrow();
    expect(() => requireNameList(['é'.repeat(MAX_NAME_LEN / 2 + 1)])).toThrow();
    // A lone surrogate encodes as U+FFFD, three bytes.
    expect(() => requireNameList(['a', '\uD800'.repeat(134)])).toThrow();
    expect(() => requireNameList(['a', '\uD800'.repeat(133)])).not.toThrow();
    // Only the first name has to be present.
    expect(() => requireNameList(['a', ' '])).not.toThrow();
    expect(() => requireNameList([' ', 'a'])).toThrow();
  });
});
