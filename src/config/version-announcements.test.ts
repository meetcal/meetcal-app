import {
  getAnnouncementForVersion,
  parseSeenVersions,
  VERSION_ANNOUNCEMENTS,
} from "@/config/version-announcements";

describe("parseSeenVersions", () => {
  it("returns an empty list when nothing is stored", () => {
    expect(parseSeenVersions(null)).toEqual([]);
    expect(parseSeenVersions(undefined)).toEqual([]);
    expect(parseSeenVersions("")).toEqual([]);
  });

  it("returns the stored versions", () => {
    expect(parseSeenVersions('["6.1.0","6.2.0"]')).toEqual(["6.1.0", "6.2.0"]);
  });

  it("treats non-JSON as nothing seen instead of throwing", () => {
    expect(parseSeenVersions("6.1.0")).toEqual([]);
    expect(parseSeenVersions("{oops")).toEqual([]);
  });

  it("treats a non-array blob as nothing seen", () => {
    // The old code called `.push` on this and threw inside the dismiss
    // handler, so the announcement could never be dismissed for good.
    expect(parseSeenVersions('{"6.1.0":true}')).toEqual([]);
    expect(parseSeenVersions('"6.1.0"')).toEqual([]);
    expect(parseSeenVersions("null")).toEqual([]);
  });

  it("drops non-string entries", () => {
    expect(parseSeenVersions('["6.1.0",null,7,{"a":1}]')).toEqual(["6.1.0"]);
  });
});

describe("getAnnouncementForVersion", () => {
  it("shows the iPhone Duo / iOS 27 announcement on iOS only", () => {
    expect(VERSION_ANNOUNCEMENTS["6.2.0"].platforms).toEqual(["ios"]);
    expect(getAnnouncementForVersion("6.2.0", "ios")?.message).toMatch(/iPhone Duo/);
    expect(getAnnouncementForVersion("6.2.0", "android")).toBeNull();
  });

  it("shows the 6.2.1 bug-fix announcement on every platform", () => {
    expect(getAnnouncementForVersion("6.2.1", "ios")?.message).toBe("Bug fixes and improvements.");
    expect(getAnnouncementForVersion("6.2.1", "android")?.message).toBe("Bug fixes and improvements.");
  });

  it("shows an announcement without platforms everywhere", () => {
    expect(getAnnouncementForVersion("6.1.0", "ios")).not.toBeNull();
    expect(getAnnouncementForVersion("6.1.0", "android")).not.toBeNull();
  });

  it("has nothing for a version without an announcement", () => {
    expect(getAnnouncementForVersion("0.0.1", "ios")).toBeNull();
  });
});
