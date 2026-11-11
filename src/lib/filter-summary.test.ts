import { filterSummary } from "./filter-summary";

describe("filterSummary", () => {
  it("joins the chosen filters", () => {
    expect(filterSummary(["Worlds", "Senior", "Women"], "All rankings")).toBe(
      "Worlds • Senior • Women",
    );
  });

  it("leaves out a filter that is not chosen yet", () => {
    expect(filterSummary(["", "Men", "Senior"], "All records")).toBe("Men • Senior");
    expect(filterSummary([undefined, null, " ", "Men"], "All records")).toBe("Men");
  });

  it("shows the placeholder when nothing is chosen", () => {
    expect(filterSummary(["", "", ""], "All rankings")).toBe("All rankings");
  });
});
