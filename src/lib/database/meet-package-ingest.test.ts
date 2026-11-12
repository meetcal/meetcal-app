import { validatePrefetchedLiftingResults } from "@/lib/database/meet-package-ingest";

describe("validatePrefetchedLiftingResults", () => {
  it("does not throw when a meet has athletes but no results yet", () => {
    expect(() =>
      validatePrefetchedLiftingResults("Test Meet" as any, ["Athlete A"], []),
    ).not.toThrow();
  });

  it("does not throw when there are no athletes", () => {
    expect(() =>
      validatePrefetchedLiftingResults("Test Meet" as any, [], []),
    ).not.toThrow();
  });

  it("does not throw when lifting results are present", () => {
    expect(() =>
      validatePrefetchedLiftingResults(
        "Test Meet" as any,
        ["Athlete A"],
        [{ name: "Athlete A" }],
      ),
    ).not.toThrow();
  });

  it("throws when lifting results exist but none match athlete names", () => {
    expect(() =>
      validatePrefetchedLiftingResults(
        "Test Meet" as any,
        ["Athlete A"],
        [{ name: "Different Athlete" }],
      ),
    ).toThrow("No matched lifting results fetched for meet athletes: Test Meet");
  });

  it("accepts normalized name matches", () => {
    expect(() =>
      validatePrefetchedLiftingResults(
        "Test Meet" as any,
        [" Athlete A "],
        [{ name: "athlete   a" }],
      ),
    ).not.toThrow();
  });
});
