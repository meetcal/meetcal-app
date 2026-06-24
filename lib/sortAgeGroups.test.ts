import { sortAgeGroups } from "@/lib/sortAgeGroups";

describe("sortAgeGroups", () => {
  it("orders known age groups by competitive progression", () => {
    expect(sortAgeGroups(["senior", "junior", "youth", "u15"])).toEqual([
      "u15",
      "youth",
      "junior",
      "senior",
    ]);
  });

  it("is case-insensitive for known groups", () => {
    expect(sortAgeGroups(["Senior", "Junior"])).toEqual(["Junior", "Senior"]);
  });

  it("includes extended groups only when requested", () => {
    const groups = ["senior", "u23", "junior"];
    // Without extended order, u23 is unknown and sorts after known groups.
    expect(sortAgeGroups(groups)).toEqual(["junior", "senior", "u23"]);
    // With extended order, u23 slots between junior and senior.
    expect(sortAgeGroups(groups, { includeExtended: true })).toEqual([
      "junior",
      "u23",
      "senior",
    ]);
  });

  it("sorts masters groups numerically and after standard groups", () => {
    expect(
      sortAgeGroups(["Masters 50", "senior", "Masters 35", "Masters 40"]),
    ).toEqual(["senior", "Masters 35", "Masters 40", "Masters 50"]);
  });

  it("sorts unknown non-masters groups alphabetically before masters", () => {
    expect(sortAgeGroups(["Masters 35", "Adaptive"])).toEqual([
      "Adaptive",
      "Masters 35",
    ]);
  });
});
