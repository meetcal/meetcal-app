import {
  sortWeightClasses,
  parseStartTimeToMinutes,
  compareStartTimes,
  calculateWeighInTime,
  getAgeCategory,
  parseWeightClasses,
  formatSessionDisplayDate,
  isMeetName,
} from "@/lib/start-list-utils";

describe("sortWeightClasses", () => {
  it("orders numerically ignoring non-digit characters", () => {
    const input = ["89kg", "55kg", "102kg", "73kg"];
    expect([...input].sort(sortWeightClasses)).toEqual([
      "55kg",
      "73kg",
      "89kg",
      "102kg",
    ]);
  });

  it("places the '+' (super-heavy) class after the same number", () => {
    expect(sortWeightClasses("87+", "87")).toBe(1);
    expect(sortWeightClasses("87", "87+")).toBe(-1);
  });

  it("sorts unparseable classes to the end", () => {
    const input = ["89kg", "unknown", "55kg"];
    expect([...input].sort(sortWeightClasses)).toEqual([
      "55kg",
      "89kg",
      "unknown",
    ]);
  });
});

describe("parseStartTimeToMinutes", () => {
  it("parses 12-hour AM/PM times", () => {
    expect(parseStartTimeToMinutes("9:30 AM")).toBe(9 * 60 + 30);
    expect(parseStartTimeToMinutes("1:00 PM")).toBe(13 * 60);
    expect(parseStartTimeToMinutes("12:00 AM")).toBe(0);
    expect(parseStartTimeToMinutes("12:00 PM")).toBe(12 * 60);
  });

  it("parses 24-hour times", () => {
    expect(parseStartTimeToMinutes("14:45")).toBe(14 * 60 + 45);
    expect(parseStartTimeToMinutes("00:00")).toBe(0);
  });

  it("returns null for malformed or out-of-range input", () => {
    expect(parseStartTimeToMinutes("13:00 PM")).toBeNull(); // 13 invalid for 12h
    expect(parseStartTimeToMinutes("9:60 AM")).toBeNull();
    expect(parseStartTimeToMinutes("25:00")).toBeNull();
    expect(parseStartTimeToMinutes("noon")).toBeNull();
    expect(parseStartTimeToMinutes("")).toBeNull();
  });
});

describe("compareStartTimes", () => {
  it("orders parseable times chronologically", () => {
    expect(compareStartTimes("9:00 AM", "10:00 AM")).toBeLessThan(0);
    expect(compareStartTimes("2:00 PM", "9:00 AM")).toBeGreaterThan(0);
  });

  it("sorts parseable times ahead of unparseable ones", () => {
    expect(compareStartTimes("9:00 AM", "TBD")).toBeLessThan(0);
    expect(compareStartTimes("TBD", "9:00 AM")).toBeGreaterThan(0);
  });

  it("falls back to string compare when neither parses", () => {
    expect(compareStartTimes("AAA", "BBB")).toBeLessThan(0);
  });
});

describe("calculateWeighInTime", () => {
  it("subtracts two hours and keeps AM/PM formatting", () => {
    expect(calculateWeighInTime("10:00 AM")).toBe("8:00 AM");
    expect(calculateWeighInTime("2:30 PM")).toBe("12:30 PM");
  });

  it("wraps around midnight", () => {
    expect(calculateWeighInTime("1:00 AM")).toBe("11:00 PM");
  });

  it("returns null for invalid input", () => {
    expect(calculateWeighInTime("nope")).toBeNull();
    expect(calculateWeighInTime("25:00 AM")).toBeNull();
    expect(calculateWeighInTime("10:00")).toBeNull(); // missing period
  });
});

describe("getAgeCategory", () => {
  it("maps youth and senior age brackets", () => {
    expect(getAgeCategory(12)).toBe("U13");
    expect(getAgeCategory(15)).toBe("U15");
    expect(getAgeCategory(17)).toBe("U17");
    expect(getAgeCategory(19)).toBe("Junior");
    expect(getAgeCategory(25)).toBe("Senior");
  });

  it("buckets masters into five-year groups starting at 35", () => {
    expect(getAgeCategory(35)).toBe("Masters 35");
    expect(getAgeCategory(39)).toBe("Masters 35");
    expect(getAgeCategory(40)).toBe("Masters 40");
    expect(getAgeCategory(88)).toBe("Masters 85");
    expect(getAgeCategory(95)).toBe("Masters 90+");
  });

  it("does not invent a masters bucket for missing or non-finite ages", () => {
    expect(getAgeCategory(Number.NaN)).toBe("Unknown");
    expect(getAgeCategory(-1)).toBe("Unknown");
    expect(getAgeCategory(0)).toBe("Unknown");
  });
});

describe("parseWeightClasses", () => {
  it("normalizes single and slash-separated classes", () => {
    expect(parseWeightClasses("89")).toEqual(["89kg"]);
    expect(parseWeightClasses("89kg / 96kg")).toEqual(["89kg", "96kg"]);
    expect(parseWeightClasses("87+")).toEqual(["87+kg"]);
  });

  it("dedupes and ignores invalid tokens", () => {
    expect(parseWeightClasses("89 / 89")).toEqual(["89kg"]);
    expect(parseWeightClasses("abc / 55")).toEqual(["55kg"]);
    expect(parseWeightClasses("")).toEqual([]);
  });
});

describe("formatSessionDisplayDate", () => {
  it("returns relative labels verbatim", () => {
    expect(formatSessionDisplayDate("Today")).toBe("Today");
    expect(formatSessionDisplayDate("Tomorrow")).toBe("Tomorrow");
  });

  it("formats an ISO full date in the supplied timezone", () => {
    expect(
      formatSessionDisplayDate(undefined, "2026-01-15T00:00:00", "UTC"),
    ).toBe("Thu, Jan 15");
  });

  it("returns empty string when nothing is provided", () => {
    expect(formatSessionDisplayDate()).toBe("");
  });
});

describe("isMeetName", () => {
  it("treats any non-null string as a meet name", () => {
    expect(isMeetName("Worlds")).toBe(true);
    expect(isMeetName(null)).toBe(false);
  });
});
