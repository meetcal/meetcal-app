import * as fc from 'fast-check';

import { isoCalendarDateArb, timeZoneArb } from '@/test-support/arbitraries';

/**
 * Generators and oracles for the time and date property tests. Test-only.
 *
 * The oracles read a zone's wall clock through their own `Intl` formatter
 * (`hourCycle: 'h23'`, seconds included) rather than through
 * `utils/timezone`, so a property compares the app's answer with an
 * independent reading instead of with itself. Every oracle names its zone;
 * none reads the device zone.
 */

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

/** The window the shared date generator covers (1990-2040). */
const MIN_INSTANT_MS = Date.UTC(1990, 0, 1);
const MAX_INSTANT_MS = Date.UTC(2040, 11, 31, 23, 59, 59, 999);

/** Zones USA Weightlifting meets run in: the zones a session time is read in. */
export const US_MEET_TIME_ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Puerto_Rico',
] as const;

/**
 * UTC instants of US DST changes (2am local, so 06:00-10:00Z across the US
 * zones) and of the Lord Howe and Chatham changes, whose 30-minute and
 * 2:45am shifts break code that assumes whole hours at 2am.
 */
const DST_CHANGE_INSTANTS_MS = [
  Date.UTC(2025, 2, 9, 7),
  Date.UTC(2025, 10, 2, 6),
  Date.UTC(2026, 2, 8, 7),
  Date.UTC(2026, 2, 8, 10),
  Date.UTC(2026, 10, 1, 6),
  Date.UTC(2026, 10, 1, 9),
  Date.UTC(2027, 2, 14, 7),
  Date.UTC(2027, 10, 7, 6),
  Date.UTC(2026, 3, 4, 15), // Lord Howe, 2am +11 -> 1:30am +10:30
  Date.UTC(2026, 3, 4, 14), // Chatham, 3:45am +13:45 -> 2:45am +12:45
] as const;

/** Any instant 1990-2040, to the millisecond. */
const uniformInstantArb = fc
  .integer({ min: MIN_INSTANT_MS, max: MAX_INSTANT_MS })
  .map((ms) => new Date(ms));

/** An instant within two days of a DST change. */
const nearDstChangeArb = fc
  .tuple(fc.constantFrom(...DST_CHANGE_INSTANTS_MS), fc.integer({ min: -2 * MS_PER_DAY, max: 2 * MS_PER_DAY }))
  .map(([change, delta]) => new Date(change + delta));

/** A UTC instant, biased to the days around DST changes. */
export const instantArb: fc.Arbitrary<Date> = fc.oneof(
  { weight: 2, arbitrary: uniformInstantArb },
  { weight: 1, arbitrary: nearDstChangeArb },
);

/** A zone a meet runs in, plus the shared edge and random zones. */
export const meetTimeZoneArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 2, arbitrary: fc.constantFrom(...US_MEET_TIME_ZONES) },
  { weight: 1, arbitrary: timeZoneArb },
);

export type WallClock = { date: string; hour: number; minute: number };

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * A wall clock that lands in DST gaps and overlaps often: a DST-change date
 * in a zone that changes then, at an hour around the change.
 */
const nearDstWallClockArb: fc.Arbitrary<{ timeZone: string } & WallClock> = fc
  .record({
    pick: fc.constantFrom(
      { timeZone: 'America/New_York', date: '2026-03-08' },
      { timeZone: 'America/New_York', date: '2026-11-01' },
      { timeZone: 'America/Chicago', date: '2025-03-09' },
      { timeZone: 'America/Denver', date: '2027-11-07' },
      { timeZone: 'America/Los_Angeles', date: '2026-03-08' },
      { timeZone: 'America/Los_Angeles', date: '2026-11-01' },
      { timeZone: 'Australia/Lord_Howe', date: '2026-04-05' },
      { timeZone: 'Australia/Lord_Howe', date: '2026-10-04' },
      { timeZone: 'Pacific/Chatham', date: '2026-04-05' },
      { timeZone: 'Pacific/Chatham', date: '2026-09-27' },
      { timeZone: 'Pacific/Auckland', date: '2026-04-05' },
      { timeZone: 'Pacific/Auckland', date: '2026-09-27' },
      { timeZone: 'Europe/London', date: '2026-03-29' },
      { timeZone: 'Europe/London', date: '2026-10-25' },
      { timeZone: 'America/Santiago', date: '2026-09-06' },
    ),
    hour: fc.integer({ min: 0, max: 4 }),
    minute: fc.integer({ min: 0, max: 59 }),
  })
  .map(({ pick, hour, minute }) => ({ ...pick, hour, minute }));

/** A meet-local wall clock in some zone: any date and time, or one near a DST change. */
export const zonedWallClockArb: fc.Arbitrary<{ timeZone: string } & WallClock> = fc.oneof(
  {
    weight: 2,
    arbitrary: fc.record({
      timeZone: meetTimeZoneArb,
      date: isoCalendarDateArb,
      hour: fc.integer({ min: 0, max: 23 }),
      minute: fc.integer({ min: 0, max: 59 }),
    }),
  },
  { weight: 1, arbitrary: nearDstWallClockArb },
);

/**
 * Renders `hour:minute` the ways meets and stored sessions spell it: `HH:MM`
 * or `H:MM`, optional seconds, `h:mm AM`/`h:mm:ss pm`, with or without the
 * space, padded with whitespace.
 */
export function clockStringArb(hour: number, minute: number): fc.Arbitrary<string> {
  const twelveHour = hour % 12 || 12;
  const meridiem = hour >= 12 ? 'PM' : 'AM';
  return fc
    .record({
      style: fc.constantFrom('24', '12'),
      padHour: fc.boolean(),
      seconds: fc.option(fc.integer({ min: 0, max: 59 }), { nil: undefined }),
      space: fc.constantFrom(' ', '', '  '),
      lower: fc.boolean(),
      surround: fc.constantFrom('', ' ', '\t'),
    })
    .map(({ style, padHour, seconds, space, lower, surround }) => {
      const secondsPart = seconds === undefined ? '' : `:${pad(seconds)}`;
      const body =
        style === '24'
          ? `${padHour ? pad(hour) : hour}:${pad(minute)}${secondsPart}`
          : `${twelveHour}:${pad(minute)}${secondsPart}${space}${lower ? meridiem.toLowerCase() : meridiem}`;
      return `${surround}${body}${surround}`;
    });
}

/** A valid clock string together with the 24-hour time it names. */
export const parsedClockArb: fc.Arbitrary<{ text: string; hour: number; minute: number }> = fc
  .record({ hour: fc.integer({ min: 0, max: 23 }), minute: fc.integer({ min: 0, max: 59 }) })
  .chain(({ hour, minute }) => clockStringArb(hour, minute).map((text) => ({ text, hour, minute })));

/**
 * A clock string shaped like a valid one with exactly one field out of range:
 * a 12-hour hour of 0 or 13+, a 24-hour hour of 24+, a minute or a second of
 * 60+.
 */
export const outOfRangeClockArb: fc.Arbitrary<string> = fc.oneof(
  fc
    .record({ hour: fc.oneof(fc.constant(0), fc.integer({ min: 13, max: 99 })), minute: fc.integer({ min: 0, max: 59 }) })
    .map(({ hour, minute }) => `${hour}:${pad(minute)} PM`),
  fc
    .record({ hour: fc.integer({ min: 24, max: 99 }), minute: fc.integer({ min: 0, max: 59 }) })
    .map(({ hour, minute }) => `${hour}:${pad(minute)}`),
  fc
    .record({
      hour: fc.integer({ min: 0, max: 23 }),
      minute: fc.integer({ min: 60, max: 99 }),
      twelve: fc.boolean(),
    })
    .map(({ hour, minute, twelve }) =>
      twelve ? `${hour % 12 || 12}:${minute} AM` : `${pad(hour)}:${minute}`,
    ),
  fc
    .record({
      hour: fc.integer({ min: 0, max: 23 }),
      minute: fc.integer({ min: 0, max: 59 }),
      second: fc.integer({ min: 60, max: 99 }),
      twelve: fc.boolean(),
    })
    .map(({ hour, minute, second, twelve }) =>
      twelve ? `${hour % 12 || 12}:${pad(minute)}:${second} PM` : `${pad(hour)}:${pad(minute)}:${second}`,
    ),
);

type ZonedReading = WallClock & { second: number };

const ORACLE_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function oracleFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = ORACLE_FORMATTERS.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    ORACLE_FORMATTERS.set(timeZone, formatter);
  }
  return formatter;
}

/** The wall clock `instant` shows in `timeZone`. */
export function readWallClock(timeZone: string, instant: Date | number): ZonedReading {
  const parts = oracleFormatter(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return {
    date: `${String(read('year')).padStart(4, '0')}-${pad(read('month'))}-${pad(read('day'))}`,
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** The meet-local calendar date at `instant`. */
export function meetLocalDate(timeZone: string, instant: Date | number): string {
  return readWallClock(timeZone, instant).date;
}

/** A wall clock as minutes on a naive (zone-free) UTC axis, for differences. */
export function naiveMinutes({ date, hour, minute }: WallClock): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day, hour, minute) / MS_PER_MINUTE;
}

/** The zone's offset in minutes at `instant`, read from the oracle formatter. */
export function oracleOffsetMinutes(timeZone: string, instant: Date | number): number {
  const ms = typeof instant === 'number' ? instant : instant.getTime();
  const wholeSecond = Math.floor(ms / 1000) * 1000;
  const reading = readWallClock(timeZone, wholeSecond);
  const localMs = naiveMinutes(reading) * MS_PER_MINUTE + reading.second * 1000;
  return (localMs - wholeSecond) / MS_PER_MINUTE;
}

/** `YYYY-MM-DD` shifted by whole days, on the calendar (no zone involved). */
export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function sameWallClock(a: WallClock, b: WallClock): boolean {
  return a.date === b.date && a.hour === b.hour && a.minute === b.minute;
}

/**
 * Whether any instant reads `wall` in `timeZone` (false in a spring-forward
 * gap): the candidates are the naive instant less each offset in force within
 * a day of it, read off the oracle (no zone changes offset twice in a day).
 */
export function wallClockExists(timeZone: string, wall: WallClock): boolean {
  const naiveMs = naiveMinutes(wall) * MS_PER_MINUTE;
  const offsets = new Set<number>();
  for (let hours = -24; hours <= 24; hours += 3) {
    offsets.add(oracleOffsetMinutes(timeZone, naiveMs + hours * MS_PER_HOUR));
  }
  return [...offsets].some((offset) =>
    sameWallClock(readWallClock(timeZone, naiveMs - offset * MS_PER_MINUTE), wall),
  );
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The schedule title for a `YYYY-MM-DD` ("Saturday, Jun 20"), from calendar
 * arithmetic alone: day-of-week counted from the epoch, no formatter, no zone.
 */
export function calendarDateTitle(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const daysSinceEpoch = Date.UTC(year, month - 1, day) / MS_PER_DAY;
  // 1970-01-01 was a Thursday.
  const weekday = WEEKDAYS[(((daysSinceEpoch + 4) % 7) + 7) % 7];
  return `${weekday}, ${MONTHS[month - 1]} ${day}`;
}

/** The UTC calendar date of `instant`, from its components. */
export function utcCalendarDate(instant: Date | number): string {
  return new Date(instant).toISOString().slice(0, 10);
}

/**
 * Suffixes a meet date field can carry after `YYYY-MM-DD`: none, a zone-free
 * time (read as device-local by `new Date`), UTC, and a US offset late enough
 * to be the next day in UTC.
 */
export const isoDateSuffixArb: fc.Arbitrary<string> = fc.constantFrom(
  '',
  'T00:00:00',
  'T23:59:59',
  'T12:00:00Z',
  'T00:00:00.000Z',
  'T23:30:00-07:00',
);
