import * as fc from 'fast-check';

import type { Meet } from '@/data/types/meet';
import { getTodayInMeetTimeZone, isMeetTodayOrOngoing } from '@/lib/next-session';
import { isoCalendarDateArb } from '@/test-support/arbitraries';
import {
  addCalendarDays,
  calendarDateTitle,
  instantArb,
  isoDateSuffixArb,
  meetLocalDate,
  meetTimeZoneArb,
  readWallClock,
  utcCalendarDate,
  wallClockExists,
  zonedWallClockArb,
} from '@/test-support/time-arbitraries';
import type { DaySchedule } from '@/types/schedule';
import {
  calculateInitialPage,
  formatIsoDateTitle,
  getCalendarDateInTimeZone,
  getHistoryCutoffDate,
  meetCalendarDateAnchor,
  toMeetCalendarDate,
} from '@/utils/dateTime';
import { convertZonedLocalToUTC } from '@/utils/timezone';

/**
 * The calendar-date properties that depend on the *device* zone not leaking
 * in: AGENTS.md's first recurring lesson (`new Date("2026-06-20")` read back
 * as local is Jun 19 in the US; local midnight read back as UTC is the day
 * before east of Greenwich). One copy, run by one small file per pinned
 * device zone (`dateTime.*device.property.test.ts`); each file's docblock
 * pins the zone and this asserts it took.
 */
export function describeDeviceZoneProperties(deviceTimeZone: string): void {
  describe(`calendar dates on a ${deviceTimeZone} device`, () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('runs on the pinned device zone', () => {
      // Compared through Intl so an alias matches (ICU reports Asia/Kolkata
      // as Asia/Calcutta).
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
        new Intl.DateTimeFormat('en-US', { timeZone: deviceTimeZone }).resolvedOptions().timeZone,
      );
    });

    it('titles a meet date, or the date part of an ISO date-time, as that calendar day', () => {
      fc.assert(
        fc.property(isoCalendarDateArb, isoDateSuffixArb, (date, suffix) => {
          expect(formatIsoDateTitle(`${date}${suffix}`)).toBe(calendarDateTitle(date));
        }),
      );
    });

    it('takes the calendar date of a meet date field verbatim', () => {
      fc.assert(
        fc.property(isoCalendarDateArb, isoDateSuffixArb, (date, suffix) => {
          expect(toMeetCalendarDate(`${date}${suffix}`)).toBe(date);
        }),
      );
    });

    // The anchor is read back in UTC, not in a US meet zone: meets abroad
    // keep their own zone, and noon UTC is already the next day from UTC+12
    // (Auckland) eastward, so every caller formats it with `timeZone: 'UTC'`.
    it('anchors a meet date to an instant that reads as that date in UTC', () => {
      fc.assert(
        fc.property(isoCalendarDateArb, (date) => {
          const anchor = meetCalendarDateAnchor(date);
          expect(anchor).not.toBeNull();
          expect(utcCalendarDate(anchor!)).toBe(date);
        }),
      );
    });

    it("reads today's date in the meet zone, not the device zone", () => {
      fc.assert(
        fc.property(meetTimeZoneArb, instantArb, (timeZone, now) => {
          const expected = meetLocalDate(timeZone, now);
          expect(getCalendarDateInTimeZone(timeZone, now)).toBe(expected);
          expect(getTodayInMeetTimeZone(timeZone, now)).toBe(expected);
        }),
      );
    });

    it('counts a meet as today exactly while its dates span the meet-zone date', () => {
      fc.assert(
        fc.property(
          meetTimeZoneArb,
          instantArb,
          fc.integer({ min: -3, max: 3 }),
          fc.integer({ min: 0, max: 4 }),
          (timeZone, now, startShift, length) => {
            const today = meetLocalDate(timeZone, now);
            const start = addCalendarDays(today, startShift);
            const end = addCalendarDays(start, length);
            const meet = {
              time: { timeZoneIdentifier: timeZone },
              dates: { start, end },
              status: 'upcoming',
            } as Meet;
            expect(isMeetTodayOrOngoing(meet, timeZone, now)).toBe(start <= today && today <= end);
          },
        ),
      );
    });

    it('cuts history off at the same UTC calendar date on every device', () => {
      fc.assert(
        fc.property(instantArb, fc.integer({ min: 0, max: 10 }), (now, years) => {
          const [year, month, day] = utcCalendarDate(now).split('-').map(Number);
          const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
          const cutoffYear = String(year - years).padStart(4, '0');
          // Feb 29 into a non-leap year is Mar 1, as `Date.UTC` rolls it and
          // as `HistoryCutoff` in plugins/ios-app-intents/MeetCalAPI.swift
          // mirrors it.
          const expected =
            month === 2 && day === 29 && !isLeap(year - years)
              ? `${cutoffYear}-03-01`
              : `${cutoffYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          expect(getHistoryCutoffDate(years, now)).toBe(expected);
        }),
      );
    });

    it("opens the schedule on the meet zone's today, else the next day, else the last", () => {
      jest.useFakeTimers();
      fc.assert(
        fc.property(
          meetTimeZoneArb,
          instantArb,
          fc.uniqueArray(fc.integer({ min: -4, max: 4 }), { minLength: 1, maxLength: 6 }),
          (timeZone, now, dayShifts) => {
            jest.setSystemTime(now);
            const today = meetLocalDate(timeZone, now);
            const schedule: DaySchedule[] = [...dayShifts]
              .sort((a, b) => a - b)
              .map((shift) => ({ date: '', fullDate: addCalendarDays(today, shift), sessions: [] }));
            const firstUpcoming = schedule.findIndex((day) => day.fullDate >= today);

            expect(calculateInitialPage(schedule, timeZone)).toBe(
              firstUpcoming === -1 ? schedule.length - 1 : firstUpcoming,
            );
          },
        ),
      );
    });

    it('turns a meet-local wall clock into an instant that reads back the same', () => {
      fc.assert(
        fc.property(zonedWallClockArb, ({ timeZone, ...wall }) => {
          fc.pre(wallClockExists(timeZone, wall));
          const time = `${wall.hour}:${String(wall.minute).padStart(2, '0')}`;
          expect(readWallClock(timeZone, convertZonedLocalToUTC(wall.date, time, timeZone))).toMatchObject(wall);
        }),
      );
    });
  });
}
