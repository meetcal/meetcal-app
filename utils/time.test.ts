import {
  AUTO_UNSAVE_DELAY_MS,
  calculateWeighInTime,
  formatTo12Hour,
  hasSessionPassedAutoUnsaveWindow,
} from "@/utils/time";

describe("formatTo12Hour", () => {
  it("converts 24-hour clock strings", () => {
    expect(formatTo12Hour("09:00")).toBe("9:00 AM");
    expect(formatTo12Hour("13:05")).toBe("1:05 PM");
    expect(formatTo12Hour("00:30")).toBe("12:30 AM");
    expect(formatTo12Hour("12:00")).toBe("12:00 PM");
    expect(formatTo12Hour("23:59")).toBe("11:59 PM");
  });

  it("drops seconds from both input formats", () => {
    expect(formatTo12Hour("13:05:00")).toBe("1:05 PM");
    // The API emits both "9:00 AM" and "9:00:00 AM"; the share image used to
    // render the second one verbatim, seconds and all.
    expect(formatTo12Hour("9:00:00 AM")).toBe("9:00 AM");
    expect(formatTo12Hour("9:00AM")).toBe("9:00 AM");
  });

  it("returns a blank for a missing time rather than inventing one", () => {
    expect(formatTo12Hour("")).toBe("");
    expect(formatTo12Hour(null)).toBe("");
    expect(formatTo12Hour(undefined)).toBe("");
  });

  it("passes through anything it cannot parse", () => {
    expect(formatTo12Hour("TBD")).toBe("TBD");
    expect(formatTo12Hour("24:00")).toBe("24:00");
    expect(formatTo12Hour("9")).toBe("9");
  });
});

describe("calculateWeighInTime", () => {
  beforeEach(() => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("subtracts two hours from a 12-hour time", () => {
    expect(calculateWeighInTime("10:00 AM")).toBe("8:00 AM");
    expect(calculateWeighInTime("2:30 PM")).toBe("12:30 PM");
    expect(calculateWeighInTime("12:00 PM")).toBe("10:00 AM");
  });

  it("accepts 24-hour times", () => {
    expect(calculateWeighInTime("14:00")).toBe("12:00 PM");
    expect(calculateWeighInTime("09:15")).toBe("7:15 AM");
  });

  it("accepts 12-hour times with seconds or no space", () => {
    expect(calculateWeighInTime("9:00:00 AM")).toBe("7:00 AM");
    expect(calculateWeighInTime("2:30PM")).toBe("12:30 PM");
  });

  it("wraps around midnight", () => {
    expect(calculateWeighInTime("1:00 AM")).toBe("11:00 PM");
    expect(calculateWeighInTime("12:00 AM")).toBe("10:00 PM");
  });

  it("reports an unknown weigh-in rather than inventing one", () => {
    // Regression: this used to return a hard-coded "6:00 AM", which then got
    // persisted onto the saved session, pushed to the API and shipped in the
    // reminder notification's deep-link params.
    expect(calculateWeighInTime("garbage")).toBe("");
    expect(calculateWeighInTime("99:99 AM")).toBe("");
  });

  it("treats a missing start time as unknown, without warning", () => {
    // `formatApiTime` maps a null `start_time` to "", and that reaches every
    // unguarded call site in useSavedSessions / schedule-details.
    const warn = jest.spyOn(console, "warn");
    expect(calculateWeighInTime("")).toBe("");
    expect(calculateWeighInTime("   ")).toBe("");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("hasSessionPassedAutoUnsaveWindow", () => {
  const now = new Date("2026-06-26T12:00:00Z");

  it("returns false before two hours have elapsed", () => {
    const start = new Date(now.getTime() - (AUTO_UNSAVE_DELAY_MS - 60_000));
    expect(hasSessionPassedAutoUnsaveWindow(start, now)).toBe(false);
  });

  it("returns false for a session that has not started yet", () => {
    const start = new Date(now.getTime() + 60 * 60 * 1000);
    expect(hasSessionPassedAutoUnsaveWindow(start, now)).toBe(false);
  });

  it("returns true once exactly two hours have elapsed", () => {
    const start = new Date(now.getTime() - AUTO_UNSAVE_DELAY_MS);
    expect(hasSessionPassedAutoUnsaveWindow(start, now)).toBe(true);
  });

  it("returns true well after the window", () => {
    const start = new Date(now.getTime() - 5 * 60 * 60 * 1000);
    expect(hasSessionPassedAutoUnsaveWindow(start, now)).toBe(true);
  });

  it("returns false for an invalid date", () => {
    expect(hasSessionPassedAutoUnsaveWindow(new Date("nope"), now)).toBe(false);
  });
});
