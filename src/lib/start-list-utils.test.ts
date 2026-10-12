/**
 * @jest-environment-options {"deviceTimeZone": "Pacific/Auckland"}
 */
import {
  sortWeightClasses,
  parseStartTimeToMinutes,
  compareStartTimes,
  compareCalendarDates,
  getAgeCategory,
  parseWeightClasses,
  formatSessionDisplayDate,
  buildWeightClassOptions,
  matchesAdaptiveFilter,
  ADAPTIVE_ATHLETES_FILTER,
  NON_ADAPTIVE_ATHLETES_FILTER,
  applyStartListPillSelection,
  DEFAULT_START_LIST_FILTERS,
  hasActiveStartListFilters,
  isPremiumStartListPill,
  effectiveStartListSort,
  normalizeStartListAthletes,
  filterStartListAthletes,
  compareStartListAthletes,
  buildAgeGroupOptions,
  buildWsoOptions,
  getShareGroup,
  buildSessionDetailsLookup,
  STARRED_CLUBS_FILTER,
  type AthleteSortOption,
  type StartListFilters,
} from "@/lib/start-list-utils";
import type { LiftResult } from "@/data/types/athletes";

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

describe("compareCalendarDates", () => {
  it("orders ISO calendar dates chronologically", () => {
    expect(compareCalendarDates("2026-06-20", "2026-06-21")).toBeLessThan(0);
    expect(compareCalendarDates("2026-07-01", "2026-06-30")).toBeGreaterThan(0);
    expect(compareCalendarDates("2026-06-20", "2026-06-20")).toBe(0);
  });

  it("orders across month and year boundaries", () => {
    expect(compareCalendarDates("2025-12-31", "2026-01-01")).toBeLessThan(0);
    expect(compareCalendarDates("2026-09-09", "2026-09-10")).toBeLessThan(0);
  });

  it("sorts a realistic multi-day meet the same way Date did", () => {
    const days = ["2026-06-22", "2026-06-20", "2026-06-21"];
    expect([...days].sort(compareCalendarDates)).toEqual([
      "2026-06-20",
      "2026-06-21",
      "2026-06-22",
    ]);
  });

  it("stays a consistent comparator for values Date cannot parse", () => {
    // `new Date("TBD").getTime()` is NaN, which made the old comparator
    // return NaN and leave the order arbitrary.
    expect(Number.isNaN(compareCalendarDates("TBD", "2026-06-20"))).toBe(false);
    expect(compareCalendarDates("TBD", "2026-06-20")).toBeGreaterThan(0);
    expect(compareCalendarDates("2026-06-20", "TBD")).toBeLessThan(0);
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

  it("reads the unlimited class written either way round", () => {
    expect(parseWeightClasses("+87")).toEqual(["87+kg"]);
    expect(parseWeightClasses("+87kg")).toEqual(["87+kg"]);
    expect(parseWeightClasses("110+ kg")).toEqual(["110+kg"]);
    expect(parseWeightClasses("+110 / 110+")).toEqual(["110+kg"]);
  });
});

function athlete(overrides: Partial<LiftResult>): LiftResult {
  return {
    memberId: overrides.name ?? "1",
    name: "Athlete",
    age: 25,
    club: "Club",
    gender: "Male",
    weightClass: "89",
    entryTotal: 0,
    adaptive: false,
    ...overrides,
  };
}

const NO_OPTION_FILTERS = { gender: "", ageGroup: "", adaptive: "" };

describe("buildWeightClassOptions", () => {
  it("lists the heaviest class present as itself when nobody is in a plus class", () => {
    const roster = [
      athlete({ name: "A", weightClass: "94" }),
      athlete({ name: "B", weightClass: "110" }),
      athlete({ name: "C", weightClass: "110" }),
    ];
    expect(buildWeightClassOptions(roster, NO_OPTION_FILTERS)).toEqual([
      "94kg",
      "110kg",
    ]);
  });

  it("lists a plus class next to its number only when the data has one", () => {
    const roster = [
      athlete({ name: "A", weightClass: "110" }),
      athlete({ name: "B", weightClass: "+110" }),
      athlete({ name: "C", gender: "Female", weightClass: "86+" }),
      athlete({ name: "D", gender: "Female", weightClass: "77" }),
    ];
    expect(buildWeightClassOptions(roster, NO_OPTION_FILTERS)).toEqual([
      "77kg",
      "86+kg",
      "110kg",
      "110+kg",
    ]);
    expect(
      buildWeightClassOptions(roster, { ...NO_OPTION_FILTERS, gender: "female" }),
    ).toEqual(["77kg", "86+kg"]);
  });

  it("only offers classes the other pills leave in view", () => {
    const roster = [
      athlete({ name: "Youth", age: 16, weightClass: "65" }),
      athlete({ name: "Senior", age: 25, weightClass: "110+" }),
      athlete({ name: "Adaptive", age: 25, weightClass: "79", adaptive: true }),
    ];
    expect(
      buildWeightClassOptions(roster, { ...NO_OPTION_FILTERS, ageGroup: "U17" }),
    ).toEqual(["65kg"]);
    expect(
      buildWeightClassOptions(roster, {
        ...NO_OPTION_FILTERS,
        adaptive: ADAPTIVE_ATHLETES_FILTER,
      }),
    ).toEqual(["79kg"]);
    expect(
      buildWeightClassOptions(roster, {
        ...NO_OPTION_FILTERS,
        adaptive: NON_ADAPTIVE_ATHLETES_FILTER,
      }),
    ).toEqual(["65kg", "110+kg"]);
  });

  it("offers exactly the classes the filter matches", () => {
    const roster = [
      athlete({ name: "A", weightClass: "+87kg" }),
      athlete({ name: "B", weightClass: "71 / 76" }),
    ];
    for (const option of buildWeightClassOptions(roster, NO_OPTION_FILTERS)) {
      expect(
        roster.some((a) => parseWeightClasses(a.weightClass).includes(option)),
      ).toBe(true);
    }
  });
});

describe("applyStartListPillSelection", () => {
  const withClass = { ...DEFAULT_START_LIST_FILTERS, weightClass: "89kg" };

  it("clears the weight class when gender, age group or adaptive changes", () => {
    expect(applyStartListPillSelection(withClass, "gender", "Male")).toMatchObject({
      gender: "Male",
      weightClass: "",
    });
    expect(applyStartListPillSelection(withClass, "ageGroup", "U17").weightClass).toBe("");
    expect(
      applyStartListPillSelection(withClass, "adaptiveAthlete", ADAPTIVE_ATHLETES_FILTER)
        .weightClass,
    ).toBe("");
  });

  it("keeps the weight class for the other pills and ignores unknown ids", () => {
    expect(applyStartListPillSelection(withClass, "wso", "Ohio")).toMatchObject({
      wso: "Ohio",
      weightClass: "89kg",
    });
    expect(applyStartListPillSelection(withClass, "club", "x")).toBe(withClass);
  });

  it("only accepts known sorts", () => {
    expect(applyStartListPillSelection(withClass, "sort", "bestSnatch").sort).toBe("bestSnatch");
    expect(applyStartListPillSelection(withClass, "sort", "").sort).toBe("alphabetical");
    expect(applyStartListPillSelection(withClass, "sort", "bogus").sort).toBe("alphabetical");
  });
});

describe("best-lift sort gating", () => {
  it("treats only the best-lift sorts as premium", () => {
    expect(isPremiumStartListPill("sort", "bestTotal")).toBe(true);
    expect(isPremiumStartListPill("sort", "bestSnatch")).toBe(true);
    expect(isPremiumStartListPill("sort", "bestCJ")).toBe(true);
    expect(isPremiumStartListPill("sort", "entryTotal")).toBe(false);
    expect(isPremiumStartListPill("sort", "")).toBe(false);
    expect(isPremiumStartListPill("weightClass", "bestCJ")).toBe(false);
  });

  it("applies a best-lift sort only while the subscription is confirmed", () => {
    expect(effectiveStartListSort("bestCJ", true)).toBe("bestCJ");
    expect(effectiveStartListSort("bestCJ", false)).toBe("alphabetical");
    expect(effectiveStartListSort("bestCJ", null)).toBe("alphabetical");
    expect(effectiveStartListSort("entryTotal", false)).toBe("entryTotal");
  });
});

describe("hasActiveStartListFilters", () => {
  it("counts pills and a non-default sort, not the search box", () => {
    expect(hasActiveStartListFilters(DEFAULT_START_LIST_FILTERS)).toBe(false);
    expect(
      hasActiveStartListFilters({ ...DEFAULT_START_LIST_FILTERS, search: "smith" }),
    ).toBe(false);
    expect(
      hasActiveStartListFilters({ ...DEFAULT_START_LIST_FILTERS, sort: "entryTotal" }),
    ).toBe(true);
    expect(hasActiveStartListFilters({ ...DEFAULT_START_LIST_FILTERS, club: "C" })).toBe(true);
  });
});

describe("matchesAdaptiveFilter", () => {
  it("passes everyone with no filter and splits on the flag otherwise", () => {
    expect(matchesAdaptiveFilter({ adaptive: true }, "")).toBe(true);
    expect(matchesAdaptiveFilter({ adaptive: true }, ADAPTIVE_ATHLETES_FILTER)).toBe(true);
    expect(matchesAdaptiveFilter({ adaptive: false }, ADAPTIVE_ATHLETES_FILTER)).toBe(false);
    expect(matchesAdaptiveFilter({ adaptive: false }, NON_ADAPTIVE_ATHLETES_FILTER)).toBe(true);
  });
});

describe("formatSessionDisplayDate", () => {
  it("returns relative labels verbatim", () => {
    expect(formatSessionDisplayDate("Today")).toBe("Today");
    expect(formatSessionDisplayDate("Tomorrow")).toBe("Tomorrow");
  });

  // The docblock pins this file to Pacific/Auckland, east of every meet
  // (jest/device-timezone-environment.js). The Los
  // Angeles cases live in start-list-utils.us-device.test.ts.
  it("runs on a device far east of Greenwich", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Pacific/Auckland");
  });

  it("shows a calendar date as that date whatever the device zone", () => {
    expect(formatSessionDisplayDate(undefined, "2026-01-15")).toBe("Thu, Jan 15");
    expect(formatSessionDisplayDate(undefined, "2026-01-15T00:00:00")).toBe("Thu, Jan 15");
    // Not a calendar date: shown as given rather than "Invalid Date".
    expect(formatSessionDisplayDate("TBD", "TBD")).toBe("TBD");
  });

  it("formats an ISO full date with no timezone without drifting a day", () => {
    expect(formatSessionDisplayDate(undefined, "2026-01-15")).toBe("Thu, Jan 15");
    expect(formatSessionDisplayDate(undefined, "2026-01-15T00:00:00")).toBe(
      "Thu, Jan 15",
    );
  });

  it("never re-parses a non-ISO date as device-local midnight", () => {
    // Regression: with no ISO full date, the mapped day title went through
    // `new Date("January 15, 2026")` (device midnight, Jan 14 11:00 UTC here)
    // and was read back in UTC: "Wed, Jan 14".
    expect(formatSessionDisplayDate("January 15, 2026")).toBe("January 15, 2026");
    expect(formatSessionDisplayDate("January 15, 2026", "")).toBe("January 15, 2026");
    expect(formatSessionDisplayDate(undefined, "01/15/2026")).toBe("01/15/2026");
  });

  it("returns empty string when nothing is provided", () => {
    expect(formatSessionDisplayDate()).toBe("");
  });
});

describe("Start List filtering and sorting", () => {
  const roster = [
    athlete({ name: "John Smith", club: "Barbell Club", wso: " Ohio ", weightClass: "110" }),
    athlete({ name: "Jane Doe", gender: "Female", club: "Lift House", age: 16, weightClass: "64" }),
    athlete({ name: "Alex Moore", club: "Barbell Club", adaptive: true, entryTotal: 250 }),
  ];
  const normalized = normalizeStartListAthletes(roster);
  const names = (list: LiftResult[]) => list.map((a) => a.name);
  const run = (overrides: Partial<StartListFilters>, starred: string[] = []) =>
    names(
      filterStartListAthletes(normalized, { ...DEFAULT_START_LIST_FILTERS, ...overrides }, starred),
    );

  it("keeps everyone with the default filters", () => {
    expect(run({})).toEqual(["John Smith", "Jane Doe", "Alex Moore"]);
  });

  it("applies each pill", () => {
    expect(run({ weightClass: "110kg" })).toEqual(["John Smith"]);
    expect(run({ club: "Barbell Club" })).toEqual(["John Smith", "Alex Moore"]);
    expect(run({ club: STARRED_CLUBS_FILTER }, ["Lift House"])).toEqual(["Jane Doe"]);
    expect(run({ ageGroup: "U17" })).toEqual(["Jane Doe"]);
    expect(run({ adaptive: ADAPTIVE_ATHLETES_FILTER })).toEqual(["Alex Moore"]);
    expect(run({ gender: "female" })).toEqual(["Jane Doe"]);
    expect(run({ wso: "Ohio" })).toEqual(["John Smith"]);
  });

  it("searches names word by word", () => {
    expect(run({ search: "Smith " })).toEqual(["John Smith"]);
    expect(run({ search: "smith john" })).toEqual(["John Smith"]);
    expect(run({ search: "smith jane" })).toEqual([]);
  });

  it("sorts A-Z, by entry total, and by bests with no bests last", () => {
    const bests = {
      "Jane Doe": { bestSnatch: 70, bestCJ: 90, bestTotal: 160 },
      "John Smith": { bestSnatch: 120, bestCJ: 150, bestTotal: 270 },
    };
    const sorted = (sort: AthleteSortOption) =>
      names([...roster].sort(compareStartListAthletes(sort, bests)));
    expect(sorted("alphabetical")).toEqual(["Alex Moore", "Jane Doe", "John Smith"]);
    expect(sorted("entryTotal")).toEqual(["Alex Moore", "Jane Doe", "John Smith"]);
    expect(sorted("bestSnatch")).toEqual(["John Smith", "Jane Doe", "Alex Moore"]);
    expect(sorted("bestCJ")).toEqual(["John Smith", "Jane Doe", "Alex Moore"]);
    expect(sorted("bestTotal")).toEqual(["John Smith", "Jane Doe", "Alex Moore"]);
  });
});

describe("Start List pill options", () => {
  it("lists the age groups present in age order", () => {
    expect(
      buildAgeGroupOptions([
        athlete({ name: "a", age: 40 }),
        athlete({ name: "b", age: 15 }),
        athlete({ name: "c", age: 0 }),
      ]),
    ).toEqual(["U15", "Masters 40"]);
  });

  it("lists distinct trimmed WSOs A-Z", () => {
    expect(
      buildWsoOptions([
        athlete({ name: "a", wso: " Ohio" }),
        athlete({ name: "b", wso: "Florida" }),
        athlete({ name: "c", wso: "Ohio " }),
        athlete({ name: "d", wso: "  " }),
        athlete({ name: "e" }),
      ]),
    ).toEqual(["Florida", "Ohio"]);
  });
});

describe("getShareGroup", () => {
  it("prefers a club, never the Favorites filter, then the WSO", () => {
    expect(getShareGroup({ club: "Barbell Club", wso: "Ohio" })).toBe("Barbell Club");
    expect(getShareGroup({ club: STARRED_CLUBS_FILTER, wso: "Ohio" })).toBe("Ohio");
    expect(getShareGroup({ club: STARRED_CLUBS_FILTER, wso: "" })).toBe("");
  });
});

describe("buildSessionDetailsLookup", () => {
  it("finds a session's day and times by number", () => {
    const lookup = buildSessionDetailsLookup([
      {
        date: "Saturday",
        fullDate: "2026-06-20",
        sessions: [
          {
            id: "1",
            number: 3,
            startTime: "9:00 AM",
            weighInTime: "7:00 AM",
            platforms: [{ platform: "Red", weightClass: "89" }],
          },
        ],
      },
    ]);
    expect(lookup(3)).toEqual({
      date: "2026-06-20",
      displayDate: "Saturday",
      startTime: "9:00 AM",
      weighInTime: "7:00 AM",
      platforms: [{ platform: "Red", weightClass: "89" }],
    });
    expect(lookup(4)).toBeNull();
  });
});
