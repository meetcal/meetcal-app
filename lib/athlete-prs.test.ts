import { findPRIndexes } from "@/lib/athlete-prs";
import { SupabaseLiftResult } from "@/types/athlete-results";

function row(overrides: Partial<SupabaseLiftResult>): SupabaseLiftResult {
  return {
    id: 0,
    event_id: "e",
    meet: "Meet",
    date: "2024-01-01",
    name: "Athlete",
    age: 25,
    body_weight: 80,
    snatch1: null,
    snatch2: null,
    snatch3: null,
    snatch_best: null,
    cj1: null,
    cj2: null,
    cj3: null,
    cj_best: null,
    total: null,
    ...overrides,
  };
}

describe("findPRIndexes", () => {
  it("flags the single clear PR for each lift", () => {
    const results = [
      row({ date: "2024-01-01", snatch_best: 90, cj_best: 110, total: 200 }),
      row({ date: "2024-06-01", snatch_best: 100, cj_best: 120, total: 220 }),
      row({ date: "2024-09-01", snatch_best: 95, cj_best: 115, total: 210 }),
    ];
    expect(findPRIndexes(results)).toEqual({ snatch: 1, cj: 1, total: 1 });
  });

  it("flags only the earliest meet when the best is tied across two meets", () => {
    const results = [
      row({ date: "2024-06-01", snatch_best: 100 }),
      row({ date: "2024-01-01", snatch_best: 100 }),
    ];
    // Index 1 is chronologically earlier, so it owns the PR.
    expect(findPRIndexes(results).snatch).toBe(1);
  });

  it("lets the parseable date win a tie when the other date is unparseable", () => {
    const results = [
      row({ date: "not-a-date", snatch_best: 100 }),
      row({ date: "2024-01-01", snatch_best: 100 }),
    ];
    expect(findPRIndexes(results).snatch).toBe(1);
  });

  it("still flags a row with an unparseable date when it is the only positive value", () => {
    const results = [row({ date: "garbage", snatch_best: 100 })];
    expect(findPRIndexes(results).snatch).toBe(0);
  });

  it("handles each lift PR'd at a different meet", () => {
    const results = [
      row({ date: "2024-01-01", snatch_best: 120, cj_best: 100, total: 200 }),
      row({ date: "2024-02-01", snatch_best: 90, cj_best: 150, total: 210 }),
      row({ date: "2024-03-01", snatch_best: 80, cj_best: 110, total: 260 }),
    ];
    expect(findPRIndexes(results)).toEqual({ snatch: 0, cj: 1, total: 2 });
  });

  it("never selects non-positive or non-numeric values, returning -1 when none qualify", () => {
    const results = [
      row({ snatch_best: 0, cj_best: -50, total: null }),
      row({ snatch_best: null, cj_best: 0, total: undefined as unknown as number }),
    ];
    expect(findPRIndexes(results)).toEqual({ snatch: -1, cj: -1, total: -1 });
  });

  it("returns -1 for every lift on empty results", () => {
    expect(findPRIndexes([])).toEqual({ snatch: -1, cj: -1, total: -1 });
  });
});
