import {
  cacheAuthState,
  clearAuthCache,
  getCachedAuthState,
  refreshAuthCacheForVerifiedUser,
} from "@/lib/authCache";

const mockStore = new Map<string, string>();

/**
 * Per-payload write latency, so a test can make one write outrun another.
 * SecureStore is a real keychain round trip on device; treating it as
 * instantaneous is what hid the write race in the first place.
 */
let mockWriteDelayMs: (value: string) => number = () => 0;

const mockWait = (ms: number) =>
  ms === 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async (key: string, value: string) => {
    await mockWait(mockWriteDelayMs(value));
    mockStore.set(key, value);
  }),
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(async () => true),
}));

describe("auth cache", () => {
  beforeEach(async () => {
    mockStore.clear();
    mockWriteDelayMs = () => 0;
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    await clearAuthCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("round-trips a valid signed-in payload", async () => {
    await cacheAuthState(true, "user-1");
    await expect(getCachedAuthState()).resolves.toMatchObject({
      isSignedIn: true,
      userId: "user-1",
    });
  });

  it("shares one keychain read between concurrent callers", async () => {
    // Every screen's `useAuthGuard` reads the hint on mount; without the
    // in-flight join a tab switch issued one SecureStore round trip each.
    await cacheAuthState(true, "user-1");
    const SecureStore = jest.requireMock("expo-secure-store");
    SecureStore.getItemAsync.mockClear();

    const reads = await Promise.all(
      Array.from({ length: 5 }, () => getCachedAuthState()),
    );

    expect(SecureStore.getItemAsync).toHaveBeenCalledTimes(1);
    expect(reads.every((read) => read?.userId === "user-1")).toBe(true);

    // Released afterwards: a later read goes back to the store.
    await getCachedAuthState();
    expect(SecureStore.getItemAsync).toHaveBeenCalledTimes(2);
  });

  it("clears malformed JSON instead of throwing", async () => {
    mockStore.set("auth_state_cache", "{not-json");
    await expect(getCachedAuthState()).resolves.toBeNull();
  });

  it("clears structurally invalid payloads", async () => {
    mockStore.set(
      "auth_state_cache",
      JSON.stringify({ isSignedIn: "yes", timestamp: "now" }),
    );
    await expect(getCachedAuthState()).resolves.toBeNull();
    expect(mockStore.has("auth_state_cache")).toBe(false);
  });

  it("can be cleared after a successful write", async () => {
    await cacheAuthState(true, "user-1");
    await clearAuthCache();
    await expect(getCachedAuthState()).resolves.toBeNull();
  });

  it("does not leave a signed-in entry behind when a sign-out races a sign-in", async () => {
    // Regression: the two writes ran concurrently and shared one `.finally`,
    // so whichever settled first released the in-flight tracking for both.
    // `clearAuthCache` then saw nothing in flight, deleted the key, and the
    // loser's write landed after the delete.
    // The sign-in write is the slow one, so under the old code the sign-out
    // write settled first and released the shared in-flight tracking.
    mockWriteDelayMs = (value) => (JSON.parse(value).isSignedIn ? 30 : 1);

    const signIn = cacheAuthState(true, "user-1");
    const signOut = cacheAuthState(false);
    const cleared = clearAuthCache();
    await Promise.all([signIn, signOut, cleared]);

    expect(mockStore.has("auth_state_cache")).toBe(false);
    await expect(getCachedAuthState()).resolves.toBeNull();
  });

  it("preserves the latest sign-in after a queued sign-out", async () => {
    await cacheAuthState(true, "user-1");
    await Promise.all([cacheAuthState(false), cacheAuthState(true, "user-1")]);
    await expect(getCachedAuthState()).resolves.toMatchObject({
      isSignedIn: true,
      userId: "user-1",
    });
  });

  it("preserves a sign-in queued after clearing the same user", async () => {
    await cacheAuthState(true, "user-1");
    await Promise.all([clearAuthCache(), cacheAuthState(true, "user-1")]);
    await expect(getCachedAuthState()).resolves.toMatchObject({
      isSignedIn: true,
      userId: "user-1",
    });
  });

  it.each(["1e400", "-1", String(Date.now() + 8 * 24 * 60 * 60 * 1000)])(
    "rejects an invalid cache timestamp %s",
    async (timestamp) => {
      mockStore.set("auth_state_cache", `{"isSignedIn":true,"timestamp":${timestamp}}`);
      await expect(getCachedAuthState()).resolves.toBeNull();
      expect(mockStore.has("auth_state_cache")).toBe(false);
    },
  );

  it("keeps an entry whose timestamp is slightly in the future", async () => {
    // A write made while the clock ran fast, read after it was corrected.
    const timestamp = Date.now() + 60 * 60 * 1000;
    mockStore.set(
      "auth_state_cache",
      JSON.stringify({ isSignedIn: true, timestamp, userId: "user-1" }),
    );
    await expect(getCachedAuthState()).resolves.toMatchObject({
      isSignedIn: true,
      userId: "user-1",
    });
    expect(mockStore.has("auth_state_cache")).toBe(true);
  });

  it("slides the expiry for a verified user only while online", async () => {
    const stale = Date.now() - 6 * 24 * 60 * 60 * 1000;
    mockStore.set(
      "auth_state_cache",
      JSON.stringify({ isSignedIn: true, timestamp: stale, userId: "user-1" }),
    );
    await getCachedAuthState();

    await refreshAuthCacheForVerifiedUser("user-1", async () => false);
    expect(JSON.parse(mockStore.get("auth_state_cache")!).timestamp).toBe(stale);

    await refreshAuthCacheForVerifiedUser("user-1", async () => {
      throw new Error("probe failed");
    });
    expect(JSON.parse(mockStore.get("auth_state_cache")!).timestamp).toBe(stale);

    await refreshAuthCacheForVerifiedUser("user-1", async () => true);
    expect(JSON.parse(mockStore.get("auth_state_cache")!).timestamp).toBeGreaterThan(stale);
  });

  it("discards a read that resolves after sign-out clears the cache", async () => {
    await cacheAuthState(true, "user-1");
    const staleValue = mockStore.get("auth_state_cache");
    let resolveRead!: (value: string | undefined) => void;
    jest.requireMock("expo-secure-store").getItemAsync.mockImplementationOnce(
      () => new Promise((resolve) => { resolveRead = resolve; }),
    );
    const reading = getCachedAuthState();
    await Promise.resolve();
    await clearAuthCache();
    resolveRead(staleValue);
    await expect(reading).resolves.toBeNull();
    await cacheAuthState(true, "user-1");
    expect(mockStore.has("auth_state_cache")).toBe(true);
  });

  it("expires signed-in hints after seven days even while offline", async () => {
    jest.requireMock("@/lib/networkUtils").isNetworkAvailable.mockResolvedValue(false);
    mockStore.set("auth_state_cache", JSON.stringify({
      isSignedIn: true,
      userId: "user-1",
      timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000,
    }));
    await expect(getCachedAuthState()).resolves.toBeNull();
    expect(mockStore.has("auth_state_cache")).toBe(false);
  });

  it("slides the expiry when the same state is re-verified a day later", async () => {
    // Regression: `getCachedAuthState` seeds the dedupe signature from what it
    // read, so a re-verification with an unchanged signature early-returned
    // and never refreshed `timestamp`. A user who signed in on day 0 and used
    // the app online every day was still evicted on day 7, losing the offline
    // fallback the cache exists for.
    const dayZero = Date.UTC(2026, 0, 1, 12);
    jest.spyOn(Date, "now").mockReturnValue(dayZero);
    await cacheAuthState(true, "user-1");
    expect(JSON.parse(mockStore.get("auth_state_cache")!).timestamp).toBe(
      dayZero,
    );

    // Same signature, read back first (as every app start does).
    const daySix = dayZero + 6 * 24 * 60 * 60 * 1000;
    jest.spyOn(Date, "now").mockReturnValue(daySix);
    await getCachedAuthState();
    await cacheAuthState(true, "user-1");
    expect(JSON.parse(mockStore.get("auth_state_cache")!).timestamp).toBe(
      daySix,
    );

    // Day 8 is inside the 7-day window measured from the day-6 refresh.
    const dayEight = dayZero + 8 * 24 * 60 * 60 * 1000;
    jest.spyOn(Date, "now").mockReturnValue(dayEight);
    await expect(getCachedAuthState()).resolves.toMatchObject({
      isSignedIn: true,
    });
  });

  it("does not rewrite an unchanged entry within the refresh interval", async () => {
    const setItemAsync = jest.requireMock("expo-secure-store")
      .setItemAsync as jest.Mock;
    await cacheAuthState(true, "user-1");
    const writes = setItemAsync.mock.calls.length;
    await cacheAuthState(true, "user-1");
    expect(setItemAsync.mock.calls.length).toBe(writes);
  });
});
