import type { Meet } from "@/data/types/meet";
import { toMeetCalendarDate } from "@/utils/dateTime";
import {
  getUpcomingMeetsWindow,
  selectUpcomingMeets,
} from "@/hooks/useUpcomingMeets";

const meet = (name: string, start: string, end = start): Meet =>
  ({ id: name, name, dates: { start, end } }) as unknown as Meet;

// Local midnight on 2026-09-20, the way getDateInTimeZone returns "today".
const today = new Date(2026, 8, 20);

describe("getUpcomingMeetsWindow", () => {
  it("spans the first of the month monthsRange back to the last of the month ahead", () => {
    expect(getUpcomingMeetsWindow(today, 3)).toEqual({
      start: "2026-06-01",
      end: "2026-12-31",
    });
  });

  it("rolls the year over at both ends", () => {
    expect(getUpcomingMeetsWindow(new Date(2026, 0, 15), 3)).toEqual({
      start: "2025-10-01",
      end: "2026-04-30",
    });
  });
});

describe("toMeetCalendarDate", () => {
  it("keeps the calendar-date part of an ISO timestamp", () => {
    expect(toMeetCalendarDate("2026-06-20T00:00:00Z")).toBe("2026-06-20");
  });

  it("rejects anything that isn't a calendar date", () => {
    expect(toMeetCalendarDate("TBD")).toBe("");
    expect(toMeetCalendarDate(undefined)).toBe("");
    expect(toMeetCalendarDate(null)).toBe("");
  });
});

describe("selectUpcomingMeets", () => {
  it("keeps a meet that ends on the very first day of the window", () => {
    // Regression: comparing `new Date("2026-06-01")` (UTC midnight) against a
    // locally-built range start dropped this meet on every US device.
    const boundary = meet("Boundary", "2026-05-29", "2026-06-01");
    expect(selectUpcomingMeets([boundary], today, 3)).toEqual([boundary]);
  });

  it("keeps a meet that starts on the very last day of the window", () => {
    const boundary = meet("NewYearsEve", "2026-12-31");
    expect(selectUpcomingMeets([boundary], today, 3)).toEqual([boundary]);
  });

  it("drops meets entirely outside the window", () => {
    expect(
      selectUpcomingMeets(
        [meet("TooOld", "2026-05-20", "2026-05-31"), meet("TooNew", "2027-01-01")],
        today,
        3,
      ),
    ).toEqual([]);
  });

  it("treats a missing end date as a single-day meet", () => {
    const single = { id: "s", name: "s", dates: { start: "2026-06-01" } } as unknown as Meet;
    expect(selectUpcomingMeets([single], today, 3)).toEqual([single]);
  });

  it("drops meets with an unusable start date", () => {
    expect(
      selectUpcomingMeets([meet("Unknown", "TBD", "2026-07-01")], today, 3),
    ).toEqual([]);
  });

  it("sorts by start date, earliest first", () => {
    const a = meet("A", "2026-09-01");
    const b = meet("B", "2026-07-04");
    const c = meet("C", "2026-11-20");
    expect(selectUpcomingMeets([a, b, c], today, 3).map((m) => m.name)).toEqual([
      "B",
      "A",
      "C",
    ]);
  });
});
