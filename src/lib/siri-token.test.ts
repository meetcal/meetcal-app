import * as fs from "fs";
import * as path from "path";

import { issueSiriToken, revokeApiToken } from "@/lib/api/meetcal-api";
import {
  readStoredSiriToken,
  resetSiriTokenForTests,
  SIRI_TOKEN_KEY,
  SIRI_TOKEN_KEYCHAIN_SERVICE,
  SIRI_TOKEN_RENEW_BEFORE_MS,
  SIRI_TOKEN_RETRY_AFTER_MS,
  syncSiriToken,
  type SiriTokenState,
  type StoredSiriToken,
} from "./siri-token";

const mockStore = new Map<string, string>();
const mockStoreOptions: unknown[] = [];

jest.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  setItemAsync: jest.fn(async (key: string, value: string, options: unknown) => {
    mockStoreOptions.push(options);
    mockStore.set(key, value);
  }),
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

jest.mock("@/lib/api/meetcal-api", () => ({
  issueSiriToken: jest.fn(),
  revokeApiToken: jest.fn(async () => {}),
}));

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const clock = () => NOW;

const issued = (id: string, expiresAt = NOW + 90 * DAY) => ({ token: `jwt-${id}`, tokenId: id, expiresAt });
const stored = (): StoredSiriToken | null => {
  const raw = mockStore.get(SIRI_TOKEN_KEY);
  return raw === undefined ? null : (JSON.parse(raw) as StoredSiriToken);
};
const store = (token: StoredSiriToken) => mockStore.set(SIRI_TOKEN_KEY, JSON.stringify(token));

const state = (overrides: Partial<SiriTokenState> = {}): SiriTokenState => ({
  isLoaded: true,
  userId: "user_a",
  subscribed: true,
  getClerkToken: jest.fn(async () => "clerk-token"),
  ...overrides,
});

beforeEach(() => {
  mockStore.clear();
  mockStoreOptions.length = 0;
  resetSiriTokenForTests();
  jest.mocked(issueSiriToken).mockReset().mockResolvedValue(issued("t1"));
  jest.mocked(revokeApiToken).mockReset().mockResolvedValue(undefined);
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe("syncSiriToken", () => {
  it("issues a token for a signed-in subscriber who has none, and stores it where Siri reads it", async () => {
    await syncSiriToken(state(), clock);
    expect(issueSiriToken).toHaveBeenCalledWith("clerk-token");
    expect(stored()).toEqual({ ...issued("t1"), userId: "user_a" });
    expect(mockStoreOptions).toEqual([{ keychainService: SIRI_TOKEN_KEYCHAIN_SERVICE, keychainAccessible: 1 }]);
  });

  it("keeps a token that is far from expiring", async () => {
    store({ ...issued("t0", NOW + SIRI_TOKEN_RENEW_BEFORE_MS + 1), userId: "user_a" });
    await syncSiriToken(state(), clock);
    expect(issueSiriToken).not.toHaveBeenCalled();
    expect(revokeApiToken).not.toHaveBeenCalled();
    expect(stored()?.tokenId).toBe("t0");
  });

  it("replaces a token expiring within two weeks, then ends the old one", async () => {
    store({ ...issued("t0", NOW + SIRI_TOKEN_RENEW_BEFORE_MS), userId: "user_a" });
    await syncSiriToken(state(), clock);
    expect(stored()?.tokenId).toBe("t1");
    expect(revokeApiToken).toHaveBeenCalledWith("jwt-t0");
  });

  it("replaces an expired token without trying to end it", async () => {
    store({ ...issued("t0", NOW - 1), userId: "user_a" });
    await syncSiriToken(state(), clock);
    expect(stored()?.tokenId).toBe("t1");
    expect(revokeApiToken).not.toHaveBeenCalled();
  });

  it("issues nothing for a free user or before Clerk loads, and leaves a held token alone", async () => {
    await syncSiriToken(state({ subscribed: false }), clock);
    await syncSiriToken(state({ isLoaded: false, userId: null }), clock);
    expect(issueSiriToken).not.toHaveBeenCalled();
    store({ ...issued("t0"), userId: "user_a" });
    await syncSiriToken(state({ subscribed: false }), clock);
    await syncSiriToken(state({ isLoaded: false, userId: null }), clock);
    expect(revokeApiToken).not.toHaveBeenCalled();
    expect(stored()?.tokenId).toBe("t0");
  });

  it("on sign-out, ends the token with itself and deletes it", async () => {
    store({ ...issued("t0"), userId: "user_a" });
    await syncSiriToken(state({ userId: null }), clock);
    expect(revokeApiToken).toHaveBeenCalledWith("jwt-t0");
    expect(stored()).toBeNull();
    expect(issueSiriToken).not.toHaveBeenCalled();
  });

  it("on a change of user, ends the previous user's token and issues the new user one", async () => {
    store({ ...issued("t0"), userId: "user_a" });
    await syncSiriToken(state({ userId: "user_b" }), clock);
    expect(revokeApiToken).toHaveBeenCalledWith("jwt-t0");
    expect(stored()).toEqual({ ...issued("t1"), userId: "user_b" });
  });

  it("deletes the token on sign-out even when it cannot be ended (offline)", async () => {
    jest.mocked(revokeApiToken).mockRejectedValue(new Error("offline"));
    store({ ...issued("t0"), userId: "user_a" });
    await expect(syncSiriToken(state({ userId: null }), clock)).resolves.toBeUndefined();
    expect(stored()).toBeNull();
  });

  it("deletes a stored value it cannot read", async () => {
    mockStore.set(SIRI_TOKEN_KEY, "{not json");
    await expect(readStoredSiriToken()).resolves.toBeNull();
    expect(mockStore.has(SIRI_TOKEN_KEY)).toBe(false);
    mockStore.set(SIRI_TOKEN_KEY, JSON.stringify({ token: "jwt", tokenId: "t", expiresAt: "soon", userId: "u" }));
    await expect(readStoredSiriToken()).resolves.toBeNull();
  });

  it("does not throw when issuing fails, and waits before asking again", async () => {
    jest.mocked(issueSiriToken).mockRejectedValue(new Error("503 sign-in tokens are not configured"));
    await expect(syncSiriToken(state(), clock)).resolves.toBeUndefined();
    await syncSiriToken(state(), clock);
    expect(issueSiriToken).toHaveBeenCalledTimes(1);
    jest.mocked(issueSiriToken).mockResolvedValue(issued("t1"));
    await syncSiriToken(state(), () => NOW + SIRI_TOKEN_RETRY_AFTER_MS);
    expect(stored()?.tokenId).toBe("t1");
  });

  it("ends a token it could not store, so nobody holds a live one", async () => {
    const SecureStore = jest.requireMock("expo-secure-store") as { setItemAsync: jest.Mock };
    SecureStore.setItemAsync.mockRejectedValueOnce(new Error("keychain locked"));
    await expect(syncSiriToken(state(), clock)).resolves.toBeUndefined();
    expect(revokeApiToken).toHaveBeenCalledWith("jwt-t1");
    expect(stored()).toBeNull();
  });

  it("issues nothing without a Clerk session token", async () => {
    await syncSiriToken(state({ getClerkToken: async () => null }), clock);
    expect(issueSiriToken).not.toHaveBeenCalled();
  });

  it("runs one at a time, so overlapping checks issue once", async () => {
    await Promise.all([syncSiriToken(state(), clock), syncSiriToken(state(), clock)]);
    expect(issueSiriToken).toHaveBeenCalledTimes(1);
  });
});

describe("Siri's reader (plugins/ios-app-intents/MeetCalAPI.swift)", () => {
  const ROOT = path.join(__dirname, "..", "..");
  const swift = fs.readFileSync(path.join(ROOT, "plugins", "ios-app-intents", "MeetCalAPI.swift"), "utf8");

  it("reads the keychain item this module writes", () => {
    expect(swift).toContain(`static let service = "${SIRI_TOKEN_KEYCHAIN_SERVICE}:no-auth"`);
    expect(swift).toContain(`static let account = "${SIRI_TOKEN_KEY}"`);
  });

  it("matches where expo-secure-store puts an item without biometric protection", () => {
    // A change here (an expo-secure-store upgrade) moves the item Siri reads.
    const module = fs.readFileSync(path.join(ROOT, "node_modules", "expo-secure-store", "ios", "SecureStoreModule.swift"), "utf8");
    expect(module).toContain('var service = options.keychainService ?? "app"');
    expect(module).toContain('service.append(":\\(requireAuthentication ? "auth" : "no-auth")")');
    expect(module).toContain("kSecAttrAccount as String: encodedKey");
    expect(module).toContain("let encodedKey = Data(key.utf8)");
  });
});
