import {
  getTimeZoneAbbreviation,
  formatDayTitle,
  formatIsoDateTitle,
  calculateInitialPage,
  meetCalendarDateAnchor,
  getHistoryCutoffDate,
  YEAR_BESTS_YEARS,
} from "@/utils/dateTime";
import type { DaySchedule, Schedule } from "@/types/schedule";

// Pin a US timezone for the whole file. The date-drift regressions below are
// invisible when the runner happens to sit on UTC.
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/Los_Angeles";
});
afterAll(() => {
  process.env.TZ = originalTz;
});

const day = (overrides: Partial<DaySchedule>): DaySchedule =>
  ({ date: "", ...overrides }) as DaySchedule;

describe("getTimeZoneAbbreviation", () => {
  it("returns a short timezone name for a valid IANA id", () => {
    const abbr = getTimeZoneAbbreviation("America/New_York");
    expect(abbr).toMatch(/E[SD]T/);
  });

  it("uses the provided instant for DST vs standard abbreviations", () => {
    expect(
      getTimeZoneAbbreviation(
        "America/New_York",
        new Date("2026-01-15T17:00:00.000Z"),
      ),
    ).toBe("EST");
    expect(
      getTimeZoneAbbreviation(
        "America/New_York",
        new Date("2026-07-15T16:00:00.000Z"),
      ),
    ).toBe("EDT");
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

describe("formatIsoDateTitle", () => {
  it("renders the calendar date, not the device-local reading of UTC midnight", () => {
    // `new Date("2026-06-20")` is UTC midnight, i.e. Jun 19 17:00 in Los
    // Angeles. Formatting without an explicit UTC zone shows "Friday, Jun 19".
    expect(formatIsoDateTitle("2026-06-20")).toBe("Saturday, Jun 20");
  });

  it("handles a full ISO timestamp", () => {
    expect(formatIsoDateTitle("2026-06-20T00:00:00Z")).toBe("Saturday, Jun 20");
  });

  it("returns null for input it cannot parse", () => {
    expect(formatIsoDateTitle("TBD")).toBeNull();
    expect(formatIsoDateTitle("")).toBeNull();
  });
});

describe("meetCalendarDateAnchor", () => {
  it("anchors at noon UTC so every US meet zone reads back the same day", () => {
    const anchor = meetCalendarDateAnchor("2026-06-20")!;
    expect(anchor.toISOString()).toBe("2026-06-20T12:00:00.000Z");
    for (const timeZone of [
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "America/Anchorage",
      "Pacific/Honolulu",
      "UTC",
    ]) {
      expect(
        anchor.toLocaleDateString("en-US", { timeZone, day: "numeric" }),
      ).toBe("20");
    }
  });

  it("survives a device timezone far east of the meet", () => {
    // Device-local noon would land on the 19th in Denver from Tokyo.
    const anchor = meetCalendarDateAnchor("2026-06-20")!;
    expect(
      anchor.toLocaleDateString("en-US", {
        timeZone: "America/Denver",
        day: "numeric",
      }),
    ).toBe("20");
  });

  it("accepts a full ISO timestamp and rejects anything else", () => {
    expect(meetCalendarDateAnchor("2026-06-20T00:00:00Z")?.toISOString()).toBe(
      "2026-06-20T12:00:00.000Z",
    );
    expect(meetCalendarDateAnchor("TBD")).toBeNull();
    expect(meetCalendarDateAnchor(null)).toBeNull();
  });
});

describe("calculateInitialPage in the meet timezone", () => {
  const schedule = [
    day({ date: "d1", fullDate: "2026-06-20" }),
    day({ date: "d2", fullDate: "2026-06-21" }),
  ] as Schedule;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("stays on the current meet day during an evening session", () => {
    // 6:30pm on 2026-06-20 in Los Angeles is already 2026-06-21 in UTC.
    jest.setSystemTime(new Date("2026-06-21T01:30:00Z"));
    expect(calculateInitialPage(schedule, "America/Los_Angeles")).toBe(0);
    // Without the meet timezone we fall back to UTC and skip to the next day.
    expect(calculateInitialPage(schedule)).toBe(1);
  });

  it("advances once the meet timezone rolls over", () => {
    // 00:30 on 2026-06-21 in Los Angeles.
    jest.setSystemTime(new Date("2026-06-21T07:30:00Z"));
    expect(calculateInitialPage(schedule, "America/Los_Angeles")).toBe(1);
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

describe("getHistoryCutoffDate", () => {
  it("returns the same calendar date N years earlier", () => {
    expect(
      getHistoryCutoffDate(2, new Date("2026-06-20T12:00:00Z")),
    ).toBe("2024-06-20");
    expect(
      getHistoryCutoffDate(YEAR_BESTS_YEARS, new Date("2026-06-20T12:00:00Z")),
    ).toBe("2025-06-20");
  });

  it("is UTC-stable across the device-midnight boundary", () => {
    // The open-coded version mixed local `getFullYear()` with a UTC
    // `toISOString()`, so two devices a few hours apart disagreed on the
    // cutoff.
    expect(getHistoryCutoffDate(1, new Date("2026-01-01T00:00:00Z"))).toBe(
      "2025-01-01",
    );
    expect(getHistoryCutoffDate(1, new Date("2026-01-01T23:59:59Z"))).toBe(
      "2025-01-01",
    );
  });

  it("normalizes Feb 29 to Mar 1 rather than producing an invalid date", () => {
    expect(getHistoryCutoffDate(1, new Date("2024-02-29T12:00:00Z"))).toBe(
      "2023-03-01",
    );
  });
});
