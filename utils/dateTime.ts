import { DaySchedule, Schedule } from "@/types/schedule";

/**
 * How many timezone formatters stay resident. US meets span a handful of
 * zones, so this never fills in practice; it is the bound that keeps a
 * malformed feed from growing the map without limit.
 */
const ABBREVIATION_FORMATTER_CACHE_LIMIT = 32;

/**
 * `new Intl.DateTimeFormat(...)` costs roughly ten times a `formatToParts`
 * call on an existing instance, and `mapApiMeet` builds two per meet for the
 * whole `/meets` list on every app start, every five-minute refresh and every
 * reconnect. A formatter carries no per-call state, so one instance per zone
 * is reused across instants — the abbreviation still varies with `instant`
 * (EST vs EDT), because that is decided by `formatToParts`, not by the
 * constructor.
 */
const abbreviationFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getAbbreviationFormatter(timeZoneIdentifier: string): Intl.DateTimeFormat {
  const cached = abbreviationFormatterCache.get(timeZoneIdentifier);
  if (cached) return cached;

  // Throws for an unknown identifier. Deliberately not cached: the caller
  // turns it into "Local" and a later valid id must still be able to resolve.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZoneIdentifier,
    timeZoneName: "short",
  });

  // Insertion-ordered eviction: `Map` keys iterate oldest-first.
  while (abbreviationFormatterCache.size >= ABBREVIATION_FORMATTER_CACHE_LIMIT) {
    const oldest = abbreviationFormatterCache.keys().next();
    if (oldest.done) break;
    abbreviationFormatterCache.delete(oldest.value);
  }
  abbreviationFormatterCache.set(timeZoneIdentifier, formatter);
  return formatter;
}

/**
 * Gets the abbreviated timezone name for a given timezone identifier
 * @param timeZoneIdentifier - IANA timezone identifier (e.g., "America/New_York")
 * @returns Abbreviated timezone (e.g., "EST", "PST") or "Local" if unavailable
 */
export function getTimeZoneAbbreviation(
  timeZoneIdentifier: string,
  instant: Date = new Date(),
): string {
  try {
    return (
      getAbbreviationFormatter(timeZoneIdentifier)
        .formatToParts(instant)
        .find((part) => part.type === "timeZoneName")?.value || "Local"
    );
  } catch {
    return "Local";
  }
}

/**
 * Formats a meet calendar date (`YYYY-MM-DD`, or any ISO string) into a
 * readable title.
 *
 * Always formats in UTC. Meet dates are calendar dates, and
 * `new Date("2026-06-20")` is UTC midnight — rendering that with the device
 * timezone shows "Jun 19" everywhere west of Greenwich.
 *
 * @returns Formatted date string (e.g., "Monday, Jan 15"), or null when the
 * input cannot be parsed.
 */
export function formatIsoDateTitle(sourceDate: string): string | null {
  if (!sourceDate) return null;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sourceDate);
  const parsed = isoMatch
    ? new Date(
        Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])),
      )
    : new Date(sourceDate);
  if (Number.isNaN(parsed.getTime())) return null;

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
 * An instant that reads back as `dateIso` in any US meet timezone: noon UTC on
 * that calendar date.
 *
 * Meet dates carry no time. Anchoring at local midnight (`new Date(
 * "2026-06-20T12:00:00")` uses the *device* zone) and then rendering in the
 * *meet* zone flips the day whenever the two are more than 12 hours apart;
 * anchoring at UTC midnight loses a day everywhere west of Greenwich. Noon UTC
 * survives both.
 *
 * @returns null when `dateIso` is not a calendar date.
 */
export function meetCalendarDateAnchor(
  dateIso: string | null | undefined,
): Date | null {
  if (typeof dateIso !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateIso.trim());
  if (!match) return null;
  const anchor = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12),
  );
  return Number.isNaN(anchor.getTime()) ? null : anchor;
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
 * The calendar-date part of a meet date field, or "" when it isn't one.
 *
 * Meet dates are calendar dates, so date windows are compared as `YYYY-MM-DD`
 * strings. Going through `new Date("2026-06-01")` instead would produce UTC
 * midnight, which is the previous day in every US timezone, and a meet ending
 * on the first day of a window would be filtered out.
 */
export function toMeetCalendarDate(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  const [datePart] = value.split("T");
  return ISO_DATE_REGEX.test(datePart ?? "") ? datePart : "";
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
