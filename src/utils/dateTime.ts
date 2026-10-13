import { DaySchedule, Schedule } from "@/types/schedule";

// The zone label lives with the other zone helpers in `utils/timezone`, which
// labels each session's own date with it (`meetTimeZoneLabel`). Re-exported
// for the modules that import it from here.
export { formatGmtOffset, getTimeZoneAbbreviation } from "@/utils/timezone";

/**
 * Formats a meet calendar date (`YYYY-MM-DD`, or any ISO string) into a
 * readable title.
 *
 * Always formats in UTC. Meet dates are calendar dates, and
 * `new Date("2026-06-20")` is UTC midnight — rendering that with the device
 * timezone shows "Jun 19" everywhere west of Greenwich. An ISO date-time is
 * titled by its date part, as `toMeetCalendarDate` reads it: parsing
 * `"2026-06-20T00:00:00"` would read device-local midnight, which is Jun 19 in
 * UTC on any device east of Greenwich.
 *
 * @returns Formatted date string (e.g., "Monday, Jan 15"), or null when the
 * input cannot be parsed or names a day that does not exist (`2026-02-30`),
 * which `Date.UTC` would otherwise roll onto Mar 2.
 */
export function formatIsoDateTitle(sourceDate: string): string | null {
  if (!sourceDate) return null;

  // An ISO date is anchored by its date part, or rejected when that day does
  // not exist: `new Date("2026-02-30")` would roll it onto Mar 1.
  const parsed = ISO_DATE_REGEX.test(sourceDate.split("T")[0] ?? "")
    ? meetCalendarDateAnchor(toMeetCalendarDate(sourceDate))
    : new Date(sourceDate);
  if (!parsed || Number.isNaN(parsed.getTime())) return null;

  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

/**
 * Formats a day schedule into a readable title
 * @param day - Day schedule object containing date information
 * @returns Formatted date string (e.g., "Monday, Jan 15")
 */
export function formatDayTitle(day: DaySchedule): string {
  const sourceDate = day.fullDate || day.date;
  if (!sourceDate) return day.date;
  return formatIsoDateTitle(sourceDate) ?? day.date;
}

/**
 * An instant for a calendar date: noon UTC on it. Format it with
 * `timeZone: "UTC"` to read the date back.
 *
 * Meet dates carry no time. Anchoring at local midnight (`new Date(
 * "2026-06-20T12:00:00")` uses the *device* zone) flips the day for a device
 * far from the meet; anchoring at UTC midnight loses a day everywhere west of
 * Greenwich. Do not format the anchor in the *meet* zone either: noon UTC is
 * already the next day from UTC+12 (Auckland, Fiji) eastward.
 *
 * @returns null when `dateIso` is not a calendar date. That includes a date
 * that does not exist (`2026-02-30`, `2026-13-01`, `2027-02-29`): `Date.UTC`
 * would normalise those onto a real day (Mar 2, Jan 1 of the next year, Mar
 * 1) and a malformed feed row would render as, and be counted on, a day the
 * meet never named. Same rule as `convertZonedLocalToUTC`.
 */
export function meetCalendarDateAnchor(
  dateIso: string | null | undefined,
): Date | null {
  if (typeof dateIso !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateIso.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  // Day 0 of the next month is this month's last day; leap years included.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return null;
  return new Date(Date.UTC(year, month - 1, day, 12));
}

/**
 * Calculates the initial page/index to display in a schedule.
 *
 * @param scheduleData - Array of day schedules
 * @param timeZone - The meet's IANA timezone. Schedule days are calendar dates
 * in the meet's timezone, so "today" has to be read there too. Falling back to
 * UTC (the historical behaviour, used when the meet details have not loaded)
 * rolls over mid-afternoon in the US: a 6pm session in Los Angeles would open
 * the schedule on *tomorrow* from 5pm local onwards.
 * @returns Index of the current or next future date, or 0/last index if out of range
 */
export function calculateInitialPage(
  scheduleData: Schedule,
  timeZone?: string,
): number {
  if (!scheduleData || scheduleData.length === 0) return 0;

  const today = timeZone
    ? getCalendarDateInTimeZone(timeZone)
    : new Date().toISOString().split("T")[0];

  // Find the index of the current date or the closest future date using fullDate
  const currentDateIndex = scheduleData.findIndex(
    (day) => day.fullDate != null && day.fullDate >= today,
  );

  // If current date is before all schedule dates, return 0 (first day)
  // If current date is after all schedule dates, return the last day
  // Otherwise, return the found index
  if (currentDateIndex === -1) {
    return scheduleData.length - 1; // Current date is after all schedule dates
  }

  return currentDateIndex;
}

/**
 * Gets the current date in a specific timezone, returned as a Date object
 * @param timeZone - IANA timezone identifier (e.g., "America/Los_Angeles")
 * @param now - The instant to read; defaults to the wall clock. Callers that
 * already hold a `now` pass it so one decision never mixes two clocks.
 * @returns Date object representing the current date in the specified timezone
 */
export function getDateInTimeZone(timeZone: string, now: Date = new Date()): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(now);

    const year = Number(
      parts.find((part) => part.type === "year")?.value ?? "0",
    );
    const month = Number(
      parts.find((part) => part.type === "month")?.value ?? "1",
    );
    const day = Number(
      parts.find((part) => part.type === "day")?.value ?? "1",
    );

    return new Date(year, month - 1, day);
  } catch {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
}

/**
 * Today's calendar date (`YYYY-MM-DD`) in the given IANA timezone.
 *
 * One copy of the policy: `getDateInTimeZone` already returns a Date whose
 * *local* fields carry the target zone's calendar date, so read them back the
 * same way rather than re-deriving the offset.
 */
export function getCalendarDateInTimeZone(
  timeZone: string,
  now: Date = new Date(),
): string {
  const localMidnight = getDateInTimeZone(timeZone, now);
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${localMidnight.getFullYear()}-${pad(localMidnight.getMonth() + 1)}-${pad(
    localMidnight.getDate(),
  )}`;
}

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The calendar-date part of a meet date field, or "" when it isn't one
 * (including a day the calendar does not have, such as `2026-02-30`).
 *
 * Meet dates are calendar dates, so date windows are compared as `YYYY-MM-DD`
 * strings. Going through `new Date("2026-06-01")` instead would produce UTC
 * midnight, which is the previous day in every US timezone, and a meet ending
 * on the first day of a window would be filtered out.
 */
export function toMeetCalendarDate(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  const [datePart] = value.split("T");
  return ISO_DATE_REGEX.test(datePart ?? "") && meetCalendarDateAnchor(datePart)
    ? datePart
    : "";
}

/** The latest offset on Earth: UTC-12 ("Anywhere on Earth"). */
const ANYWHERE_ON_EARTH_OFFSET_MS = 12 * 60 * 60 * 1000;

/**
 * Today's calendar date (`YYYY-MM-DD`) in the last zone a day ends in
 * (UTC-12). A meet whose end date is before it has finished everywhere,
 * whatever its zone. Plain arithmetic, so no engine has to know `Etc/GMT+12`.
 */
export function getAnywhereOnEarthDate(now: Date = new Date()): string {
  return new Date(now.getTime() - ANYWHERE_ON_EARTH_OFFSET_MS)
    .toISOString()
    .split("T")[0];
}

/**
 * How far back the attempt estimator and the offline meet download pull an
 * athlete's competition history.
 */
export const ATTEMPT_HISTORY_YEARS = 2;

/** How far back "year bests" on the start list look. */
export const YEAR_BESTS_YEARS = 1;

/**
 * The `YYYY-MM-DD` cutoff `years` before `now`, for history windows.
 *
 * One copy of the policy: this was open-coded six times as
 * `const d = new Date(); d.setFullYear(d.getFullYear() - N);
 * d.toISOString().split("T")[0]`, which mixes *device-local* `getFullYear` with
 * a *UTC* `toISOString` and so lands on a different day either side of
 * midnight. Everything here is UTC, so the cutoff is the same instant for every
 * device.
 */
export function getHistoryCutoffDate(
  years: number,
  now: Date = new Date(),
): string {
  const cutoff = new Date(
    Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()),
  );
  return cutoff.toISOString().split("T")[0];
}
