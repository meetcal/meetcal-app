import {
  convertZonedLocalToUTC,
  getOffsetMinutesAtInstant,
  parseClockTime,
} from "@/utils/timezone";

describe("timezone utilities", () => {
  describe("parseClockTime", () => {
    it("parses 12-hour AM/PM times", () => {
      expect(parseClockTime("8:00 AM")).toEqual({ hour: 8, minute: 0 });
      expect(parseClockTime("12:00 AM")).toEqual({ hour: 0, minute: 0 });
      expect(parseClockTime("12:00 PM")).toEqual({ hour: 12, minute: 0 });
    });

  it("parses 24-hour times", () => {
    expect(parseClockTime("13:30")).toEqual({ hour: 13, minute: 30 });
    expect(parseClockTime("08:00:00")).toEqual({ hour: 8, minute: 0 });
  });

  it("rejects invalid clock strings", () => {
    expect(() => parseClockTime("25:00")).toThrow("Invalid time");
    expect(() => parseClockTime("not-a-time")).toThrow("Invalid time");
  });
  });

  describe("convertZonedLocalToUTC", () => {
    it("handles DST spring-forward boundary in New York", () => {
      const saturday = convertZonedLocalToUTC(
        "2026-03-07",
        "8:00 AM",
        "America/New_York",
      );
      const sunday = convertZonedLocalToUTC(
        "2026-03-08",
        "8:00 AM",
        "America/New_York",
      );

      expect(saturday.toISOString()).toBe("2026-03-07T13:00:00.000Z");
      expect(sunday.toISOString()).toBe("2026-03-08T12:00:00.000Z");
    });

    it("uses earlier instant for fall-back ambiguous hour", () => {
      const ambiguous = convertZonedLocalToUTC(
        "2026-11-01",
        "1:30 AM",
        "America/New_York",
      );
      expect(ambiguous.toISOString()).toBe("2026-11-01T05:30:00.000Z");
    });

    it("normalizes nonexistent spring-forward hour to the next valid local time", () => {
      const missing = convertZonedLocalToUTC(
        "2026-03-08",
        "2:30 AM",
        "America/New_York",
      );

      expect(
        missing.toLocaleString("en-US", {
          timeZone: "America/New_York",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        }),
      ).toBe("3:30 AM");
    });

    it("keeps Arizona offsets stable across DST periods", () => {
      const jan = convertZonedLocalToUTC(
        "2026-01-15",
        "8:00 AM",
        "America/Phoenix",
      );
      const jul = convertZonedLocalToUTC(
        "2026-07-15",
        "8:00 AM",
        "America/Phoenix",
      );

      expect(jan.toISOString()).toBe("2026-01-15T15:00:00.000Z");
      expect(jul.toISOString()).toBe("2026-07-15T15:00:00.000Z");
    });
  });

  describe("getOffsetMinutesAtInstant", () => {
    it("returns identical offsets for Phoenix in winter and summer", () => {
      const winterOffset = getOffsetMinutesAtInstant(
        "America/Phoenix",
        new Date("2026-01-15T15:00:00.000Z"),
      );
      const summerOffset = getOffsetMinutesAtInstant(
        "America/Phoenix",
        new Date("2026-07-15T15:00:00.000Z"),
      );

      expect(winterOffset).toBe(-420);
      expect(summerOffset).toBe(-420);
    });
  });
});
