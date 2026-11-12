import {
  formatResultDate,
  getRateColor,
  meetResultKey,
  MIDDLING_RATE_COLOR,
} from "@/lib/athlete-result-display";
import type { AthleteMeetResult } from "@/types/athlete-results";

describe("formatResultDate", () => {
  it("reads a meet date back as the calendar day it names, whatever the device zone", () => {
    expect(formatResultDate("2025-03-15")).toBe(
      new Date(Date.UTC(2025, 2, 15)).toLocaleDateString(undefined, { timeZone: "UTC" }),
    );
    expect(formatResultDate("2025-03-15")).toContain("15");
  });

  it("shows nothing for a missing date and the raw text for an unparseable one", () => {
    expect(formatResultDate(null)).toBe("");
    expect(formatResultDate(undefined)).toBe("");
    expect(formatResultDate("")).toBe("");
    expect(formatResultDate("sometime in March")).toBe("sometime in March");
  });
});

describe("getRateColor", () => {
  const colors = { success: "green", fail: "red" };

  it("colors 80% and above as success, below 70% as fail, and the band between as middling", () => {
    expect(getRateColor(100, colors)).toBe("green");
    expect(getRateColor(80, colors)).toBe("green");
    expect(getRateColor(79.9, colors)).toBe(MIDDLING_RATE_COLOR);
    expect(getRateColor(70, colors)).toBe(MIDDLING_RATE_COLOR);
    expect(getRateColor(69.9, colors)).toBe("red");
    expect(getRateColor(0, colors)).toBe("red");
  });
});

describe("meetResultKey", () => {
  it("keeps two rows of the same meet apart by their position", () => {
    const row: AthleteMeetResult = {
      event_id: "7",
      meet: "Open",
      date: "2025-03-15",
      name: "Lifter",
      age: "Open",
      body_weight: 88,
      snatch1: null,
      snatch2: null,
      snatch3: null,
      snatch_best: null,
      cj1: null,
      cj2: null,
      cj3: null,
      cj_best: null,
      total: null,
    };
    expect(meetResultKey(row, 0)).toBe("7-Open-2025-03-15-Lifter-0");
    expect(meetResultKey(row, 1)).not.toBe(meetResultKey(row, 0));
  });
});
