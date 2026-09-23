import { parseSeenVersions } from "@/config/version-announcements";

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
