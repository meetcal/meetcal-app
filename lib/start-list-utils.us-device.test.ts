/**
 * @jest-environment-options {"deviceTimeZone": "America/Los_Angeles"}
 */
// Device-zone cases for a phone west of Greenwich. `new Date("2026-01-15")`
// is UTC midnight, which a Los Angeles device reads as Jan 14 16:00. The
// docblock pins the zone before the file loads; assigning process.env.TZ
// inside a test would not change it (jest/device-timezone-environment.js).
import { formatSessionDisplayDate } from "@/lib/start-list-utils";

describe("formatSessionDisplayDate on a Los Angeles device", () => {
  it("runs on a US device zone", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/Los_Angeles");
    expect(new Date("2026-01-15").getDate()).toBe(14);
  });

  it("formats an ISO full date with no timezone without drifting a day", () => {
    // Regression: the no-timezone branch used to format UTC midnight in the
    // device zone, so a Los Angeles device read "2026-01-15" as Jan 14.
    expect(formatSessionDisplayDate(undefined, "2026-01-15")).toBe("Thu, Jan 15");
    expect(formatSessionDisplayDate(undefined, "2026-01-15T00:00:00")).toBe(
      "Thu, Jan 15",
    );
  });

  it("reads the calendar date in the meet zone, not the device zone", () => {
    expect(
      formatSessionDisplayDate(undefined, "2026-01-15", "America/New_York"),
    ).toBe("Thu, Jan 15");
    expect(
      formatSessionDisplayDate(undefined, "2026-01-15", "Pacific/Honolulu"),
    ).toBe("Thu, Jan 15");
  });

  it("shows a non-ISO date as sent", () => {
    expect(formatSessionDisplayDate("January 15, 2026")).toBe("January 15, 2026");
  });
});
