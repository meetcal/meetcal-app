import { resolveStorageUserId } from "@/lib/saved-sessions-user";

describe("resolveStorageUserId", () => {
  const base = {
    clerkUserId: null,
    isClerkLoaded: false,
    hasNetwork: true,
    cachedUserId: "cached",
  };

  it("is Clerk's user whenever Clerk has one", () => {
    expect(resolveStorageUserId({ ...base, clerkUserId: "clerk", isClerkLoaded: true })).toBe("clerk");
    expect(resolveStorageUserId({ ...base, clerkUserId: "clerk" })).toBe("clerk");
  });

  it("trusts the cached hint while Clerk is loading or offline", () => {
    expect(resolveStorageUserId(base)).toBe("cached");
    expect(resolveStorageUserId({ ...base, isClerkLoaded: true, hasNetwork: false })).toBe("cached");
  });

  it("is no one once Clerk has loaded signed out and the device is online", () => {
    expect(resolveStorageUserId({ ...base, isClerkLoaded: true })).toBeNull();
  });

  it("is no one without a cached user", () => {
    expect(resolveStorageUserId({ ...base, cachedUserId: null })).toBeNull();
  });
});
