import { weightClassSort } from "@/lib/database/weight-class-sort";

const sorted = (classes: string[]) => [...classes].sort(weightClassSort);

describe("weightClassSort", () => {
  it("orders numbered classes lightest first", () => {
    expect(sorted(["89kg", "61kg", "102kg"])).toEqual([
      "61kg",
      "89kg",
      "102kg",
    ]);
  });

  it("puts the unlimited class last regardless of its number", () => {
    expect(sorted(["+87kg", "49kg", "71kg"])).toEqual([
      "49kg",
      "71kg",
      "+87kg",
    ]);
    // The '+' wins even when a numbered class is heavier than it reads.
    expect(sorted(["+87kg", "109kg"])).toEqual(["109kg", "+87kg"]);
  });

  it("accepts bare numbers as well as kg-suffixed classes", () => {
    expect(sorted(["81", "55kg", "+110"])).toEqual(["55kg", "81", "+110"]);
  });

  it("falls back to the embedded digits when a class does not start with one", () => {
    expect(sorted(["K61kg", "45kg"])).toEqual(["45kg", "K61kg"]);
  });

  it("sorts unparseable classes last and keeps them mutually equal", () => {
    expect(weightClassSort("unknown", "other")).toBe(0);
    expect(sorted(["unknown", "81kg"])).toEqual(["81kg", "unknown"]);
  });
});
