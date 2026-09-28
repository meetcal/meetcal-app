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

    it("parses 12-hour times that carry seconds", () => {
      // Regression: the 24-hour branch already allowed optional seconds and
      // `formatTo12Hour` in data/meets/config.ts has an explicit branch for
      // this shape, but the AM/PM branch rejected it. `formatApiTime` swallows
      // the throw and returns "", so a session with `start_time: "9:00:00 AM"`
      // rendered a blank start time and was skipped by lib/next-session.
      expect(parseClockTime("9:00:00 AM")).toEqual({ hour: 9, minute: 0 });
      expect(parseClockTime("12:30:45 PM")).toEqual({ hour: 12, minute: 30 });
      expect(parseClockTime("12:00:00 AM")).toEqual({ hour: 0, minute: 0 });
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

    it("accepts a real leap day", () => {
      expect(
        convertZonedLocalToUTC("2028-02-29", "10:00 AM", "America/New_York").toISOString(),
      ).toBe("2028-02-29T15:00:00.000Z");
    });

    it("rejects calendar dates that do not exist instead of rolling them into another day", () => {
      // `Date.UTC` silently normalises these (Feb 29 2026 -> Mar 1, month 0 ->
      // the previous December). A session carrying one would get a reminder on
      // the wrong day, and a month-0 date lands in the past, which the
      // auto-unsave prune treats as "already started" and deletes.
      for (const date of ["2026-02-29", "2026-02-30", "2026-04-31", "2026-13-01", "2026-00-10", "2026-06-00"]) {
        expect(() => convertZonedLocalToUTC(date, "10:00 AM", "America/New_York")).toThrow(
          `Invalid date: ${date}`,
        );
      }
    });

    it("rejects an unknown IANA zone rather than guessing an offset", () => {
      expect(() => convertZonedLocalToUTC("2026-06-20", "10:00 AM", "Mars/Olympus")).toThrow();
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

  // Regression: `hour12: false` is not a promise of a 0-23 clock. Pre-2021
  // ECMA-402 resolved it to `h24` for en-US, which prints midnight as hour 24
  // on the same calendar day, and the app runs on whatever ICU the device
  // ships rather than on V8. Node uses `h23`, so the only way to exercise the
  // other branch is to stand in an h24 formatter.
  describe("on an ICU build that resolves hour12:false to h24", () => {
    const RealDateTimeFormat = Intl.DateTimeFormat;

    function loadWithH24Formatter(): typeof import("@/utils/timezone") {
      function H24DateTimeFormat(
        this: unknown,
        locale?: string,
        options?: Intl.DateTimeFormatOptions,
      ) {
        const real = new RealDateTimeFormat(locale, options);
        if (!options || options.hour12 !== false) return real;
        return {
          formatToParts: (value?: Date) =>
            real
              .formatToParts(value)
              .map((part) =>
                part.type === "hour" && part.value === "00"
                  ? { ...part, value: "24" }
                  : part,
              ),
        } as unknown as Intl.DateTimeFormat;
      }

      (Intl as { DateTimeFormat: unknown }).DateTimeFormat =
        H24DateTimeFormat as unknown as typeof Intl.DateTimeFormat;

      let loaded!: typeof import("@/utils/timezone");
      jest.isolateModules(() => {
        loaded = require("@/utils/timezone");
      });
      return loaded;
    }

    afterEach(() => {
      (Intl as { DateTimeFormat: unknown }).DateTimeFormat = RealDateTimeFormat;
    });

    it("still reports the real offset at meet-local midnight", () => {
      const tz = loadWithH24Formatter();

      // 2026-06-20T06:00Z is exactly 00:00 in Denver (MDT, UTC-6). Reading
      // that as hour 24 makes the offset come back +1080 instead of -360.
      expect(
        tz.getOffsetMinutesAtInstant(
          "America/Denver",
          new Date("2026-06-20T06:00:00.000Z"),
        ),
      ).toBe(-360);
    });

    it("still resolves a midnight session on a DST fall-back day", () => {
      const tz = loadWithH24Formatter();

      // 2026-11-01 is New York's fall-back day, so midnight is still EDT
      // (UTC-4). With hour 24 the correct candidate fails the exact-match
      // check and the nearest-wall-clock fallback picks 01:00 EDT instead.
      expect(
        tz
          .convertZonedLocalToUTC("2026-11-01", "12:00 AM", "America/New_York")
          .toISOString(),
      ).toBe("2026-11-01T04:00:00.000Z");
    });
  });
});

describe("timezone input assertions", () => {
  const instant = new Date("2026-06-20T16:00:00.000Z");

  it.each([undefined, null, "", "   "])(
    "throws for a missing zone (%p) instead of using the device zone",
    (zone) => {
      expect(() => getOffsetMinutesAtInstant(zone as unknown as string, instant)).toThrow(
        /Invalid time zone/,
      );
      expect(() =>
        convertZonedLocalToUTC("2026-06-20", "10:00 AM", zone as unknown as string),
      ).toThrow(/Invalid time zone/);
    },
  );

  it("still throws for an unknown IANA id", () => {
    expect(() => getOffsetMinutesAtInstant("Mars/Olympus", instant)).toThrow();
  });
});

describe("parts formatter cache", () => {
  const RealDateTimeFormat = Intl.DateTimeFormat;

  afterEach(() => {
    (Intl as { DateTimeFormat: unknown }).DateTimeFormat = RealDateTimeFormat;
  });

  it("keeps at most PARTS_FORMATTER_CACHE_LIMIT formatters, evicting the oldest", () => {
    let constructed = 0;
    function CountingDateTimeFormat(locale?: string, options?: Intl.DateTimeFormatOptions) {
      constructed += 1;
      return new RealDateTimeFormat(locale, options);
    }
    (Intl as { DateTimeFormat: unknown }).DateTimeFormat =
      CountingDateTimeFormat as unknown as typeof Intl.DateTimeFormat;

    let tz!: typeof import("@/utils/timezone");
    jest.isolateModules(() => {
      tz = require("@/utils/timezone");
    });
    const zones = Intl.supportedValuesOf("timeZone").slice(0, tz.PARTS_FORMATTER_CACHE_LIMIT + 1);
    const instant = new Date("2026-06-20T16:00:00.000Z");

    tz.getOffsetMinutesAtInstant(zones[0], instant);
    tz.getOffsetMinutesAtInstant(zones[0], instant);
    expect(constructed).toBe(1);

    for (const zone of zones.slice(1)) tz.getOffsetMinutesAtInstant(zone, instant);
    expect(constructed).toBe(zones.length);

    // The first zone was the oldest entry and has been evicted; the newest is still held.
    tz.getOffsetMinutesAtInstant(zones[zones.length - 1], instant);
    expect(constructed).toBe(zones.length);
    tz.getOffsetMinutesAtInstant(zones[0], instant);
    expect(constructed).toBe(zones.length + 1);
  });
});
