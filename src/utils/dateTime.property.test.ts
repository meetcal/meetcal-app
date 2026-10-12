/**
 * @jest-environment-options {"deviceTimeZone": "Pacific/Auckland"}
 */
import * as fc from 'fast-check';

import { hostileStringArb, hostileValueArb, isoCalendarDateArb } from '@/test-support/arbitraries';
import { describeDeviceZoneProperties } from '@/test-support/device-zone-properties';
import { instantArb, meetTimeZoneArb } from '@/test-support/time-arbitraries';
import type { DaySchedule } from '@/types/schedule';
import {
  calculateInitialPage,
  formatIsoDateTitle,
  getCalendarDateInTimeZone,
  getTimeZoneAbbreviation,
  meetCalendarDateAnchor,
  toMeetCalendarDate,
} from '@/utils/dateTime';

// The device-zone sweep's Auckland leg (the Jest default zone, pinned so a
// JEST_DEVICE_TIME_ZONE sweep cannot move it); the US, Kolkata and Santiago
// legs are the `dateTime.*-device.property.test.ts` files.
describeDeviceZoneProperties('Pacific/Auckland');

/** `YYYY-MM-DD` shaped, but a day the calendar does not have. */
const nonexistentDateArb: fc.Arbitrary<string> = fc.oneof(
  fc
    .record({ year: fc.integer({ min: 1990, max: 2040 }), month: fc.integer({ min: 1, max: 12 }), extra: fc.integer({ min: 1, max: 3 }) })
    .map(({ year, month, extra }) => {
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return { year, month, day: daysInMonth + extra };
    })
    .filter(({ day }) => day <= 31),
  fc.record({
    year: fc.integer({ min: 1990, max: 2040 }),
    month: fc.constantFrom(0, 13, 99),
    day: fc.integer({ min: 1, max: 28 }),
  }),
  fc.record({ year: fc.integer({ min: 1990, max: 2040 }), month: fc.integer({ min: 1, max: 12 }), day: fc.constant(0) }),
).map(({ year, month, day }) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);

/** No suffix, a zone-free time, or UTC. */
const isoDateSuffixOrNoneArb: fc.Arbitrary<string> = fc.constantFrom('', 'T00:00:00', 'T12:00:00Z');

describe('formatIsoDateTitle', () => {
  it('returns a title or null for any string, never throws', () => {
    fc.assert(
      fc.property(hostileStringArb, (text) => {
        const title = formatIsoDateTitle(text);
        expect(title === null || /^[A-Z][a-z]+day, [A-Z][a-z]{2} \d{1,2}$/.test(title)).toBe(true);
      }),
    );
  });

  it('returns null for a day that does not exist instead of rolling it over', () => {
    fc.assert(
      fc.property(nonexistentDateArb, isoDateSuffixOrNoneArb, (date, suffix) => {
        expect(formatIsoDateTitle(`${date}${suffix}`)).toBeNull();
      }),
    );
  });

  // Shrunk counterexamples.
  it('titles a zone-free ISO date-time by its date part on a device east of UTC', () => {
    // `new Date("2026-06-20T00:00:00")` is Auckland midnight, Jun 19 in UTC.
    expect(formatIsoDateTitle('2026-06-20T00:00:00')).toBe('Saturday, Jun 20');
  });

  it('does not roll Feb 30 onto Mar 2', () => {
    expect(formatIsoDateTitle('2026-02-30')).toBeNull();
  });
});

describe('toMeetCalendarDate', () => {
  it('returns a YYYY-MM-DD or "" for any value, and is idempotent', () => {
    fc.assert(
      fc.property(hostileValueArb, (value) => {
        const date = toMeetCalendarDate(value as string);
        expect(date === '' || /^\d{4}-\d{2}-\d{2}$/.test(date)).toBe(true);
        expect(toMeetCalendarDate(date)).toBe(date);
      }),
    );
  });

  // Found by this property: "2026-02-30" used to come back as a date, which a
  // string comparison then ordered as if it existed.
  it('rejects a day the calendar does not have', () => {
    fc.assert(
      fc.property(nonexistentDateArb, (date) => {
        expect(toMeetCalendarDate(date)).toBe('');
      }),
    );
  });
});

describe('meetCalendarDateAnchor', () => {
  it('anchors a real date at noon UTC on that date', () => {
    fc.assert(
      fc.property(isoCalendarDateArb, isoDateSuffixOrNoneArb, (date, suffix) => {
        expect(meetCalendarDateAnchor(`${date}${suffix}`)?.toISOString()).toBe(`${date}T12:00:00.000Z`);
      }),
    );
  });

  it('returns null for a nonexistent day or a value that is not a date', () => {
    fc.assert(
      fc.property(nonexistentDateArb, (date) => {
        expect(meetCalendarDateAnchor(date)).toBeNull();
      }),
    );
    fc.assert(
      fc.property(hostileValueArb, (value) => {
        const anchor = meetCalendarDateAnchor(value as string);
        expect(anchor === null || anchor.getUTCHours() === 12).toBe(true);
      }),
    );
  });
});

describe('calculateInitialPage', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('stays within the schedule for any days, zone and clock', () => {
    jest.useFakeTimers();
    const dayArb: fc.Arbitrary<DaySchedule> = fc
      .oneof(isoCalendarDateArb, hostileStringArb, fc.constant(null as unknown as string))
      .map((fullDate) => ({ date: 'Day', fullDate, sessions: [] }));
    fc.assert(
      fc.property(
        fc.array(dayArb, { maxLength: 8 }),
        fc.option(meetTimeZoneArb, { nil: undefined }),
        instantArb,
        (schedule, timeZone, now) => {
          jest.setSystemTime(now);
          const page = calculateInitialPage(schedule, timeZone);
          expect(Number.isInteger(page)).toBe(true);
          expect(page).toBeGreaterThanOrEqual(0);
          expect(page).toBeLessThanOrEqual(Math.max(0, schedule.length - 1));
        },
      ),
    );
  });
});

describe('getCalendarDateInTimeZone', () => {
  it('falls back to the device date for a zone Intl does not know, as its catch documents', () => {
    fc.assert(
      fc.property(fc.constantFrom('Mars/Olympus', 'Not/AZone', 'EST5EDT6'), instantArb, (zone, now) => {
        const pad = (value: number) => String(value).padStart(2, '0');
        expect(getCalendarDateInTimeZone(zone, now)).toBe(
          `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
        );
      }),
    );
  });
});

describe('getTimeZoneAbbreviation', () => {
  it('names any zone, falling back to "Local", and never throws', () => {
    fc.assert(
      fc.property(fc.oneof(meetTimeZoneArb, hostileStringArb), instantArb, (zone, instant) => {
        const name = getTimeZoneAbbreviation(zone, instant);
        expect(typeof name).toBe('string');
        expect(name.length).toBeGreaterThan(0);
      }),
    );
  });
});
