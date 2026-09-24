import { generateSessionId, makeLookupKey } from "@/utils/session";

const meet = "Test Meet" as never;

describe("generateSessionId", () => {
  it("keeps the historical id shape for a canonical platform", () => {
    expect(generateSessionId(meet, 3, "Red")).toBe("Test-Meet-3-Red");
  });

  it("gives 'RED ' and 'Red' the same id", () => {
    expect(generateSessionId(meet, 3, "RED ")).toBe(generateSessionId(meet, 3, "Red"));
    expect(generateSessionId(meet, 3, "red")).toBe(generateSessionId(meet, 3, "Red"));
  });

  it("gives Red and Gold in one session distinct ids", () => {
    expect(generateSessionId(meet, 3, "Red")).toBe("Test-Meet-3-Red");
    expect(generateSessionId(meet, 3, "Gold")).toBe("Test-Meet-3-Gold");
  });
});

describe("makeLookupKey", () => {
  it("matches platforms case-insensitively and ignoring padding", () => {
    expect(makeLookupKey(3, "RED ")).toBe(makeLookupKey("3", "Red"));
  });

  it("keeps different platforms apart", () => {
    expect(makeLookupKey(3, "Red")).not.toBe(makeLookupKey(3, "Gold"));
  });
});
