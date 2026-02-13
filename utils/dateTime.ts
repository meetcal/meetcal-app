import { DaySchedule, Schedule } from "@/types/schedule";

/**
 * Gets the abbreviated timezone name for a given timezone identifier
 * @param timeZoneIdentifier - IANA timezone identifier (e.g., "America/New_York")
 * @returns Abbreviated timezone (e.g., "EST", "PST") or "Local" if unavailable
 */
export function getTimeZoneAbbreviation(timeZoneIdentifier: string): string {
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: timeZoneIdentifier,
      timeZoneName: "short",
    })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value || "Local"
  );
}

/**
 * Formats a day schedule into a readable title
 * @param day - Day schedule object containing date information
 * @returns Formatted date string (e.g., "Monday, Jan 15")
 */
export function formatDayTitle(day: DaySchedule): string {
  const sourceDate = day.fullDate || day.date;
  if (!sourceDate) return day.date;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sourceDate);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const dayOfMonth = Number(isoMatch[3]);
    const utcDate = new Date(Date.UTC(year, month - 1, dayOfMonth));
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(utcDate);
  }

  const parsed = new Date(sourceDate);
  if (Number.isNaN(parsed.getTime())) return day.date;

  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(parsed);
}

/**
 * Calculates the initial page/index to display in a schedule based on current UTC date
 * @param scheduleData - Array of day schedules
 * @returns Index of the current or next future date, or 0/last index if out of range
 */
export function calculateInitialPage(scheduleData: Schedule): number {
  if (!scheduleData || scheduleData.length === 0) return 0;

  // Get current date in UTC and format as YYYY-MM-DD
  const currentUTCDate = new Date().toISOString().split("T")[0];

  // Find the index of the current date or the closest future date using fullDate
  const currentDateIndex = scheduleData.findIndex(
    (day) => day.fullDate >= currentUTCDate,
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
}
