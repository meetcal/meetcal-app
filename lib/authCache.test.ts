import {
  cacheAuthState,
  clearAuthCache,
  getCachedAuthState,
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
