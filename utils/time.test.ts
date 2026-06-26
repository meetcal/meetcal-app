import {
  AUTO_UNSAVE_DELAY_MS,
  calculateWeighInTime,
  hasSessionPassedAutoUnsaveWindow,
} from "@/utils/time";

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

  it("wraps around midnight", () => {
    expect(calculateWeighInTime("1:00 AM")).toBe("11:00 PM");
    expect(calculateWeighInTime("12:00 AM")).toBe("10:00 PM");
  });

  it("falls back to 6:00 AM for invalid input", () => {
    expect(calculateWeighInTime("garbage")).toBe("6:00 AM");
    expect(calculateWeighInTime("99:99 AM")).toBe("6:00 AM");
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
