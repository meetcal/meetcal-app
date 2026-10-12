import * as fc from 'fast-check';

import { hostileStringArb } from '@/test-support/arbitraries';
import {
  instantArb,
  meetTimeZoneArb,
  MS_PER_MINUTE,
  naiveMinutes,
  oracleOffsetMinutes,
  outOfRangeClockArb,
  parsedClockArb,
  readWallClock,
  zonedWallClockArb,
  wallClockExists,
  type WallClock,
} from '@/test-support/time-arbitraries';
import { convertZonedLocalToUTC, getOffsetMinutesAtInstant, parseClockTime } from '@/utils/timezone';

/**
 * Meet-local wall clock versus UTC. Every session reminder, the Next Session
 * card and the auto-unsave sweep turn a meet's `date` + `start_time` into an
 * instant here, so a drift of an hour (DST) or a day (zone read on the wrong
 * side of the date line) moves a real user's session.
 */

function wallClockString({ hour, minute }: WallClock): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function sameWallClock(a: WallClock, b: WallClock): boolean {
  return a.date === b.date && a.hour === b.hour && a.minute === b.minute;
}

/**
 * Every offset change since 1990 is a multiple of 15 minutes and at most three
 * hours (Antarctica/Troll's is two); these are the steps back from a result
 * at which an earlier reading of the same wall clock would sit.
 */
const OVERLAP_STEPS_MINUTES = [15, 30, 45, 60, 90, 120, 180];

describe('convertZonedLocalToUTC', () => {
  it('reads back as the same meet-local wall clock, with the earlier instant in a fall-back overlap', () => {
    fc.assert(
      fc.property(zonedWallClockArb, ({ timeZone, ...wall }) => {
        fc.pre(wallClockExists(timeZone, wall));
        const instant = convertZonedLocalToUTC(wall.date, wallClockString(wall), timeZone);

        expect(instant.getTime() % MS_PER_MINUTE).toBe(0);
        expect(readWallClock(timeZone, instant)).toMatchObject(wall);
        // Policy (timezone.test.ts, "uses earlier instant for fall-back
        // ambiguous hour"): a wall clock that occurs twice resolves to the
        // first occurrence, so a reminder never fires an hour late.
        for (const step of OVERLAP_STEPS_MINUTES) {
          expect(sameWallClock(readWallClock(timeZone, instant.getTime() - step * MS_PER_MINUTE), wall)).toBe(false);
        }
      }),
    );
  });

  it('moves a wall clock in a spring-forward gap later by exactly the gap', () => {
    fc.assert(
      fc.property(zonedWallClockArb, ({ timeZone, ...wall }) => {
        fc.pre(!wallClockExists(timeZone, wall));
        const instant = convertZonedLocalToUTC(wall.date, wallClockString(wall), timeZone);
        const shiftMinutes = naiveMinutes(readWallClock(timeZone, instant)) - naiveMinutes(wall);

        // Policy (timezone.test.ts, "normalizes nonexistent spring-forward
        // hour to the next valid local time"): 2:30 in a one-hour gap is 3:30,
        // the instant the old offset would have named. Never earlier, so a
        // session in the gap is not treated as already started.
        expect(shiftMinutes).toBeGreaterThan(0);
        expect(shiftMinutes).toBeLessThanOrEqual(180);
        const gapMinutes =
          oracleOffsetMinutes(timeZone, instant) -
          oracleOffsetMinutes(timeZone, instant.getTime() - (shiftMinutes + 1) * MS_PER_MINUTE);
        expect(shiftMinutes).toBe(gapMinutes);
      }),
      // Gaps come only from the DST-change half of the generator.
      { numRuns: Math.max(fc.readConfigureGlobal().numRuns ?? 100, 100) },
    );
  });

  // Shrunk counterexamples. Zones ahead of UTC+12 need a probe further back
  // than 12 hours to see the offset in force before their change.
  it('resolves a real Chatham time on its spring-forward day', () => {
    // 2:00 exists (the gap is 2:45-3:45); it used to come back as 1:00.
    expect(convertZonedLocalToUTC('2026-09-27', '02:00', 'Pacific/Chatham').toISOString()).toBe(
      '2026-09-26T13:15:00.000Z',
    );
  });

  it('moves an Auckland spring-forward gap time later, not earlier', () => {
    // 2:30 does not exist; it used to resolve to 1:30, an hour before.
    const instant = convertZonedLocalToUTC('2026-09-27', '02:30', 'Pacific/Auckland');
    expect(readWallClock('Pacific/Auckland', instant)).toMatchObject({ date: '2026-09-27', hour: 3, minute: 30 });
  });

  it('takes the earlier Auckland fall-back reading, as in US zones', () => {
    // 2:30 happens at +13 and again at +12; it used to pick the later one.
    expect(convertZonedLocalToUTC('2026-04-05', '02:30', 'Pacific/Auckland').toISOString()).toBe(
      '2026-04-04T13:30:00.000Z',
    );
  });
});

describe('getOffsetMinutesAtInstant', () => {
  it('is a whole number of quarter hours within UTC-12..UTC+14 and matches the zone at that instant', () => {
    fc.assert(
      fc.property(meetTimeZoneArb, instantArb, (timeZone, instant) => {
        const offset = getOffsetMinutesAtInstant(timeZone, instant);

        expect(Number.isInteger(offset)).toBe(true);
        // Every offset since 1990 is whole quarter hours (Chatham, Kathmandu).
        expect(Math.abs(offset % 15)).toBe(0);
        expect(offset).toBeGreaterThanOrEqual(-12 * 60);
        expect(offset).toBeLessThanOrEqual(14 * 60);
        expect(offset).toBe(oracleOffsetMinutes(timeZone, instant));
      }),
    );
  });

  it('ignores the seconds of the instant (shrunk counterexample)', () => {
    // The zoned parts stop at the minute, and subtracting the full instant
    // used to leave the seconds in the offset: UTC read as -0.5 minutes.
    expect(getOffsetMinutesAtInstant('UTC', new Date('2026-01-01T12:00:30Z'))).toBe(0);
    expect(getOffsetMinutesAtInstant('America/New_York', new Date('2026-01-01T12:00:59.999Z'))).toBe(-300);
  });
});

describe('parseClockTime', () => {
  it('accepts every way a valid time is written and returns the time it names', () => {
    fc.assert(
      fc.property(parsedClockArb, ({ text, hour, minute }) => {
        expect(parseClockTime(text)).toEqual({ hour, minute });
      }),
    );
  });

  it('rejects a clock with any field out of range', () => {
    fc.assert(
      fc.property(outOfRangeClockArb, (text) => {
        expect(() => parseClockTime(text)).toThrow('Invalid time');
      }),
    );
  });

  it('rejects out-of-range seconds in the 12-hour form (shrunk counterexample)', () => {
    // The 24-hour branch rejected "13:00:99"; the AM/PM branch accepted these.
    for (const text of ['12:00:60 PM', '1:00:99 PM']) {
      expect(() => parseClockTime(text)).toThrow('Invalid time');
    }
  });

  it('either rejects arbitrary input or returns an in-range time', () => {
    fc.assert(
      fc.property(hostileStringArb, (text) => {
        let parsed: { hour: number; minute: number };
        try {
          parsed = parseClockTime(text);
        } catch (error) {
          expect((error as Error).message).toMatch(/^Invalid time/);
          return;
        }
        expect(Number.isInteger(parsed.hour) && parsed.hour >= 0 && parsed.hour <= 23).toBe(true);
        expect(Number.isInteger(parsed.minute) && parsed.minute >= 0 && parsed.minute <= 59).toBe(true);
      }),
    );
  });
});
