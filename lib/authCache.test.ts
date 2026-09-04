import {
  cacheAuthState,
  clearAuthCache,
  getCachedAuthState,
} from "@/lib/authCache";

const mockStore = new Map<string, string>();

jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async (key: string, value: string) => {
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
});
