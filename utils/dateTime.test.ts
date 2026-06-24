import {
  getTimeZoneAbbreviation,
  formatDayTitle,
  calculateInitialPage,
} from "@/utils/dateTime";
import type { DaySchedule, Schedule } from "@/types/schedule";

const day = (overrides: Partial<DaySchedule>): DaySchedule =>
  ({ date: "", ...overrides }) as DaySchedule;

describe("getTimeZoneAbbreviation", () => {
  it("returns a short timezone name for a valid IANA id", () => {
    const abbr = getTimeZoneAbbreviation("America/New_York");
    expect(abbr).toMatch(/E[SD]T/);
  });

  it("returns 'Local' for an invalid timezone", () => {
    expect(getTimeZoneAbbreviation("Not/AZone")).toBe("Local");
  });
});

describe("formatDayTitle", () => {
  it("formats an ISO date without timezone drift", () => {
    expect(formatDayTitle(day({ fullDate: "2026-01-15" }))).toBe(
      "Thursday, Jan 15",
    );
  });

  it("prefers fullDate over date", () => {
    expect(
      formatDayTitle(day({ date: "ignored", fullDate: "2026-07-04" })),
    ).toBe("Saturday, Jul 4");
  });

  it("falls back to the raw date when unparseable", () => {
    expect(formatDayTitle(day({ date: "TBD" }))).toBe("TBD");
  });
});

describe("calculateInitialPage", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-24T12:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const schedule: Schedule = [
    day({ fullDate: "2026-06-22" }),
    day({ fullDate: "2026-06-24" }),
    day({ fullDate: "2026-06-26" }),
  ];

  it("returns 0 for an empty schedule", () => {
    expect(calculateInitialPage([])).toBe(0);
  });

  it("selects the current or next future day", () => {
    expect(calculateInitialPage(schedule)).toBe(1);
  });

  it("returns the last index when all days are in the past", () => {
    const past: Schedule = [
      day({ fullDate: "2026-01-01" }),
      day({ fullDate: "2026-01-02" }),
    ];
    expect(calculateInitialPage(past)).toBe(1);
  });

  it("returns the first index when all days are in the future", () => {
    const future: Schedule = [
      day({ fullDate: "2026-12-01" }),
      day({ fullDate: "2026-12-02" }),
    ];
    expect(calculateInitialPage(future)).toBe(0);
  });
});
