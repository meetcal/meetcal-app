import type { AthleteClub } from "@/types/club";
import { meetCalendarDateAnchor } from "@/utils/dateTime";

/** One meet a club entered, with its first day when the backend knows it. */
export interface ClubMeet {
  meet: string;
  /** `YYYY-MM-DD` in the meet's calendar, or null (an older answer, or a roster with no meet row). */
  date: string | null;
}

/** A leading four-digit year in a meet's name ("2026 Arnold"), or -1. */
function nameYear(meet: string): number {
  const match = /^\s*(\d{4})\b/.exec(meet);
  return match ? Number(match[1]) : -1;
}

/**
 * A club's distinct meets, newest first (#341): by date, then a meet with no
 * date by the year its name starts with, then by name. A coach opens the
 * club's recap for the meet that just finished, so it comes first.
 */
export function clubMeetsNewestFirst(athletes: readonly AthleteClub[]): ClubMeet[] {
  const dates = new Map<string, string | null>();
  for (const athlete of athletes) {
    const date = meetCalendarDateAnchor(athlete.meet_date) ? athlete.meet_date! : null;
    if (!dates.has(athlete.meet) || (dates.get(athlete.meet) === null && date !== null)) dates.set(athlete.meet, date);
  }
  return [...dates]
    .map(([meet, date]) => ({ meet, date }))
    .sort((a, b) => {
      if (a.date !== b.date) {
        if (a.date === null) return 1;
        if (b.date === null) return -1;
        return a.date < b.date ? 1 : -1;
      }
      return nameYear(b.meet) - nameYear(a.meet) || a.meet.localeCompare(b.meet);
    });
}

/** "Mar 27, 2026" for a meet's calendar date, the same on every device; null when it is not a date. */
export function formatClubMeetDate(date: string | null): string | null {
  const anchor = meetCalendarDateAnchor(date);
  if (!anchor) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(anchor);
}
