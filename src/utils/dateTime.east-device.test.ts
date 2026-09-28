/**
 * @jest-environment-options {"deviceTimeZone": "Pacific/Auckland"}
 */
// Device-zone cases for a phone far east of every meet: Pacific/Auckland
// (UTC+12 on these dates), pinned by the docblock before the file loads
// (jest/device-timezone-environment.js).
import { formatIsoDateTitle, meetCalendarDateAnchor } from "@/utils/dateTime";

describe("dateTime on a device far east of the meet", () => {
  it("runs on Pacific/Auckland", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Pacific/Auckland");
    // Device-local midnight is the previous UTC day here.
    expect(new Date(2026, 5, 20).toISOString()).toBe("2026-06-19T12:00:00.000Z");
  });

  it("anchors a meet date so a US meet zone still reads the same day", () => {
    // A device-local noon anchor is 00:00Z from Auckland, i.e. the 19th in
    // Denver and Los Angeles.
    const anchor = meetCalendarDateAnchor("2026-06-20")!;
    for (const timeZone of ["America/Denver", "America/Los_Angeles", "Pacific/Honolulu"]) {
      expect(anchor.toLocaleDateString("en-US", { timeZone, day: "numeric" })).toBe("20");
    }
  });

  it("titles an ISO date without reading it as device-local", () => {
    expect(formatIsoDateTitle("2026-06-20")).toBe("Saturday, Jun 20");
    expect(formatIsoDateTitle("2026-12-31")).toBe("Thursday, Dec 31");
  });
});
