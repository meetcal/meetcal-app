import { decodePersistedTag, encodePersistedTag, runningBundleIdentity } from "@/lib/database/persisted-tag";

describe("persisted tag encoding", () => {
  it("round-trips a tag for the same bundle only", () => {
    const stored = encodePersistedTag('"abc"', "bundle-a");
    expect(decodePersistedTag(stored, "bundle-a")).toBe('"abc"');
    expect(decodePersistedTag(stored, "bundle-b")).toBeNull();
  });

  it("stores nothing for an empty tag and reads nothing from a malformed one", () => {
    expect(encodePersistedTag(null, "b")).toBeUndefined();
    expect(encodePersistedTag("", "b")).toBeUndefined();
    expect(decodePersistedTag("no-separator", "b")).toBeNull();
    expect(decodePersistedTag(undefined, "b")).toBeNull();
    expect(decodePersistedTag(`b\u0000`, "b")).toBeNull();
  });
});

it("names the running bundle by its update and native build", () => {
  expect(runningBundleIdentity()).toMatch(/^.+:.*:.*$/);
  expect(decodePersistedTag(encodePersistedTag('"t"'))).toBe('"t"');
});
