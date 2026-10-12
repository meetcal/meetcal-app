import { emptyLoadFailure, loadFailureCopy } from "@/lib/load-failure";

describe("emptyLoadFailure", () => {
  it("is only a failure when nothing is shown", () => {
    expect(emptyLoadFailure({ shownCount: 3, hasNetwork: false, requestFailed: true })).toBeNull();
    expect(emptyLoadFailure({ shownCount: 0, hasNetwork: false, requestFailed: false })).toBe("offline");
    expect(emptyLoadFailure({ shownCount: 0, hasNetwork: true, requestFailed: true })).toBe("error");
    // The API answered with no athletes: the start list really is unpublished.
    expect(emptyLoadFailure({ shownCount: 0, hasNetwork: true, requestFailed: false })).toBeNull();
  });
});

describe("loadFailureCopy", () => {
  it("tells offline apart from a failed request", () => {
    expect(loadFailureCopy("schedule", true)).toEqual({
      title: "You're offline",
      message: "The schedule isn't saved on this device yet. Connect to the internet and try again.",
    });
    expect(loadFailureCopy("schedule", false)).toEqual({
      title: "Couldn't load the schedule",
      message: "Something went wrong while loading. Check your connection and try again.",
    });
  });

  it("never reads as \"nothing published\"", () => {
    for (const isOffline of [true, false]) {
      const { title, message } = loadFailureCopy("start list", isOffline);
      expect(`${title} ${message}`).not.toMatch(/published|no results|check back soon/i);
    }
  });
});
