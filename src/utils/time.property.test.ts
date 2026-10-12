import * as fc from 'fast-check';

import { hostileStringArb } from '@/test-support/arbitraries';
import { instantArb, outOfRangeClockArb, parsedClockArb } from '@/test-support/time-arbitraries';
import {
  AUTO_UNSAVE_DELAY_MS,
  calculateWeighInTime,
  formatTo12Hour,
  hasSessionPassedAutoUnsaveWindow,
  WEIGH_IN_LEAD_HOURS,
} from '@/utils/time';
import { parseClockTime } from '@/utils/timezone';

const TWELVE_HOUR_DISPLAY = /^(?:[1-9]|1[0-2]):[0-5]\d (?:AM|PM)$/;
const MINUTES_PER_DAY = 24 * 60;

function tryParse(text: string): { hour: number; minute: number } | null {
  try {
    return parseClockTime(text);
  } catch {
    return null;
  }
}

/** Valid, out-of-range and arbitrary clock-ish strings. */
const anyClockTextArb: fc.Arbitrary<string> = fc.oneof(
  parsedClockArb.map(({ text }) => text),
  outOfRangeClockArb,
  hostileStringArb,
);

describe('formatTo12Hour', () => {
  it('renders every valid time as h:mm AM/PM that parses back to the same time', () => {
    fc.assert(
      fc.property(parsedClockArb, ({ text, hour, minute }) => {
        const shown = formatTo12Hour(text);
        expect(shown).toMatch(TWELVE_HOUR_DISPLAY);
        expect(parseClockTime(shown)).toEqual({ hour, minute });
      }),
    );
  });

  it('never turns a time parseClockTime rejects into one it accepts, and is idempotent', () => {
    fc.assert(
      fc.property(anyClockTextArb, (text) => {
        const shown = formatTo12Hour(text);
        if (tryParse(text) === null) expect(tryParse(shown)).toBeNull();
        expect(formatTo12Hour(shown)).toBe(shown);
      }),
    );
  });

  it('renders a missing time as blank', () => {
    for (const missing of [null, undefined, '']) expect(formatTo12Hour(missing)).toBe('');
  });

  it('does not render out-of-range seconds as a valid time (shrunk counterexample)', () => {
    // The 12-hour pattern took any two digits of seconds and stripped them.
    expect(formatTo12Hour('1:00:99 PM')).toBe('1:00:99 PM');
  });
});

describe('calculateWeighInTime', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    // Unparseable start times warn by design; keep thousands of cases quiet.
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('is the weigh-in lead before the start, wrapping past midnight', () => {
    fc.assert(
      fc.property(parsedClockArb, ({ text, hour, minute }) => {
        const weighIn = calculateWeighInTime(text);
        expect(weighIn).toMatch(TWELVE_HOUR_DISPLAY);
        const expected =
          (((hour - WEIGH_IN_LEAD_HOURS) * 60 + minute) % MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY;
        const parsed = parseClockTime(weighIn);
        expect(parsed.hour * 60 + parsed.minute).toBe(expected);
      }),
    );
  });

  it('knows a weigh-in exactly when parseClockTime accepts the start time', () => {
    fc.assert(
      fc.property(anyClockTextArb, (text) => {
        expect(calculateWeighInTime(text) !== '').toBe(tryParse(text) !== null);
      }),
    );
  });

  it('drops a start time with out-of-range seconds (shrunk counterexample)', () => {
    expect(calculateWeighInTime('1:00:99 PM')).toBe('');
  });
});

describe('hasSessionPassedAutoUnsaveWindow', () => {
  const offsetArb = fc.integer({ min: -2 * AUTO_UNSAVE_DELAY_MS, max: 3 * AUTO_UNSAVE_DELAY_MS });

  it('is true exactly from the delay after the start', () => {
    fc.assert(
      fc.property(instantArb, offsetArb, (start, elapsed) => {
        const now = new Date(start.getTime() + elapsed);
        expect(hasSessionPassedAutoUnsaveWindow(start, now)).toBe(elapsed >= AUTO_UNSAVE_DELAY_MS);
      }),
    );
  });

  it('never un-passes as now moves forward', () => {
    fc.assert(
      fc.property(instantArb, offsetArb, fc.nat({ max: 2 * AUTO_UNSAVE_DELAY_MS }), (start, elapsed, later) => {
        const now = new Date(start.getTime() + elapsed);
        const after = new Date(now.getTime() + later);
        if (hasSessionPassedAutoUnsaveWindow(start, now)) {
          expect(hasSessionPassedAutoUnsaveWindow(start, after)).toBe(true);
        }
      }),
    );
  });

  it('never passes for an invalid start or clock', () => {
    fc.assert(
      fc.property(instantArb, (instant) => {
        expect(hasSessionPassedAutoUnsaveWindow(new Date(Number.NaN), instant)).toBe(false);
        expect(hasSessionPassedAutoUnsaveWindow(instant, new Date(Number.NaN))).toBe(false);
      }),
    );
  });
});
