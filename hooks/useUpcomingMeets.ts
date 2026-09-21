import { useMemo } from "react";
import { getDateInTimeZone, toMeetCalendarDate } from "@/utils/dateTime";
import { Meet } from "@/data/types/meet";

interface UseUpcomingMeetsParams {
  availableMeets: Meet[];
  monthsRange?: number;
}

interface UseUpcomingMeetsReturn {
  upcomingMeets: Meet[];
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

/** `YYYY-MM-DD` for a Date whose *local* fields carry the calendar date. */
function toCalendarDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The inclusive `YYYY-MM-DD` window a meet has to overlap to be listed. */
export function getUpcomingMeetsWindow(
  today: Date,
  monthsRange: number,
): { start: string; end: string } {
  const year = today.getFullYear();
  const month = today.getMonth();
  return {
    start: toCalendarDate(new Date(year, month - monthsRange, 1)),
    // Day 0 of the following month is the last day of the target month.
    end: toCalendarDate(new Date(year, month + monthsRange + 1, 0)),
  };
}

/** Meets overlapping a +/- `monthsRange` month window around today. */
export function selectUpcomingMeets(
  availableMeets: Meet[],
  today: Date,
  monthsRange: number,
): Meet[] {
  const window = getUpcomingMeetsWindow(today, monthsRange);

  return availableMeets
    .filter((meet) => {
      const start = toMeetCalendarDate(meet.dates?.start);
      if (!start) return false;
      const end = toMeetCalendarDate(meet.dates?.end) || start;
      return end >= window.start && start <= window.end;
    })
    .sort((a, b) =>
      toMeetCalendarDate(a.dates?.start).localeCompare(
        toMeetCalendarDate(b.dates?.start),
      ),
    );
}

export function useUpcomingMeets({
  availableMeets,
  monthsRange = 3,
}: UseUpcomingMeetsParams): UseUpcomingMeetsReturn {
  const upcomingMeets = useMemo(
    () =>
      selectUpcomingMeets(
        availableMeets,
        getDateInTimeZone("America/Los_Angeles"),
        monthsRange,
      ),
    [availableMeets, monthsRange],
  );

  return { upcomingMeets };
}
