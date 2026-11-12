import { noEstimatesCopy, staleEstimatesNote } from "@/lib/attempt-estimator-copy";

describe("noEstimatesCopy", () => {
  it("tells an offline user the session is not downloaded", () => {
    expect(noEstimatesCopy("offline")).toEqual({
      title: "You're offline",
      message: "This session isn't downloaded. Connect to the internet and try again.",
    });
  });

  it("tells a failed load apart from an empty session", () => {
    expect(noEstimatesCopy("failed").title).toBe("Couldn't load estimates");
    expect(noEstimatesCopy(null)).toEqual({
      title: "No athletes in this session",
      message: "The start list has no athletes for this session and platform yet.",
    });
  });
});

describe("staleEstimatesNote", () => {
  it("says why the downloaded estimates were not refreshed", () => {
    expect(staleEstimatesNote("offline")).toBe("Offline. Showing downloaded data.");
    expect(staleEstimatesNote("failed")).toBe("Couldn't refresh. Showing downloaded data.");
  });
});
