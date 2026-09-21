import { DaySchedule, Schedule } from "@/types/schedule";

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
      new Intl.DateTimeFormat("en-US", {
        timeZone: timeZoneIdentifier,
        timeZoneName: "short",
      })
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
 * @returns Date object representing the current date in the specified timezone
 */
export function getDateInTimeZone(timeZone: string): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(new Date());

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
    const now = new Date();
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
export function getCalendarDateInTimeZone(timeZone: string): string {
  const localMidnight = getDateInTimeZone(timeZone);
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${localMidnight.getFullYear()}-${pad(localMidnight.getMonth() + 1)}-${pad(
    localMidnight.getDate(),
  )}`;
}
