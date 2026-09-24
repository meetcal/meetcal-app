import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearSavedSessionsCache,
  commitStoredSessions,
  createSavedSessionsCache,
  normalizeStoredSession,
  parseStoredSessions,
  readStoredSessions,
  reloadStoredSessionsFallback,
  removeStoredSessions,
  type SavedSession,
  type SavedSessionsStore,
} from "@/lib/saved-sessions-store";
import { getSavedSessionsKey } from "@/utils/session";

const USER = "user_1";
const OTHER = "user_2";

const session = (overrides: Partial<SavedSession> = {}): SavedSession => ({
  id: "Test-Meet-1-Red",
  meet: "Test Meet" as never,
  sessionNumber: 1,
  platform: "Red",
  weightClass: "71kg",
  startTime: "10:00 AM",
  weighInTime: "8:00 AM",
  date: "2099-06-20",
  ...overrides,
});

function makeStore(active: string | null = USER) {
  const published: SavedSession[][] = [];
  const state = { active };
  const store: SavedSessionsStore = {
    cache: createSavedSessionsCache(),
    isActive: (userId) => state.active === userId,
    publish: (sessions) => published.push(sessions),
  };
  return { store, published, state };
}

const getItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe("normalizeStoredSession", () => {
  it("rejects non-objects and rows with no identity", () => {
    expect(normalizeStoredSession(null)).toBeNull();
    expect(normalizeStoredSession([])).toBeNull();
    expect(normalizeStoredSession("row")).toBeNull();
    expect(normalizeStoredSession({ ...session(), id: " " })).toBeNull();
    expect(normalizeStoredSession({ ...session(), meet: "" })).toBeNull();
    expect(normalizeStoredSession({ ...session(), platform: null })).toBeNull();
    expect(normalizeStoredSession({ ...session(), sessionNumber: 1.5 })).toBeNull();
    expect(normalizeStoredSession({ ...session(), sessionNumber: -1 })).toBeNull();
    // 0 is "no session assigned" to the API and to `isLiftResult`; a stored
    // row with it has nothing to open.
    expect(normalizeStoredSession({ ...session(), sessionNumber: 0 })).toBeNull();
    expect(normalizeStoredSession({ ...session(), sessionNumber: "0" })).toBeNull();
    expect(normalizeStoredSession({ ...session(), sessionNumber: 1 })).not.toBeNull();
    expect(normalizeStoredSession({ ...session(), sessionNumber: "" })).toBeNull();
  });

  it("defaults nullable text fields and coerces a numeric-string session number", () => {
    const row = normalizeStoredSession({
      ...session(),
      sessionNumber: "7",
      weightClass: null,
      startTime: undefined,
      notes: null,
      athleteName: 3,
      athleteNames: ["A", 2, "B"],
    });
    expect(row).toEqual({
      ...session(),
      sessionNumber: 7,
      weightClass: "",
      startTime: "",
      athleteNames: ["A", "B"],
    });
    expect(row).not.toHaveProperty("notes");
    expect(row).not.toHaveProperty("athleteName");
  });
});

describe("parseStoredSessions", () => {
  it("treats missing, malformed and non-array values as empty", () => {
    expect(parseStoredSessions(null)).toEqual([]);
    expect(parseStoredSessions("{not json")).toEqual([]);
    expect(parseStoredSessions('{"id":"x"}')).toEqual([]);
  });

  it("keeps valid rows and drops the rest", () => {
    const raw = JSON.stringify([session(), { id: "" }, session({ id: "b" })]);
    expect(parseStoredSessions(raw).map((s) => s.id)).toEqual(["Test-Meet-1-Red", "b"]);
  });
});

describe("readStoredSessions / commitStoredSessions", () => {
  it("returns nothing without a user", async () => {
    const { store } = makeStore();
    expect(await readStoredSessions(store, null)).toEqual([]);
    expect(getItem).not.toHaveBeenCalled();
  });

  it("serves the cached list for the same owner and re-reads when forced", async () => {
    await AsyncStorage.setItem(getSavedSessionsKey(USER), JSON.stringify([session()]));
    const { store } = makeStore();
    const first = await readStoredSessions(store, USER);
    getItem.mockClear();
    expect(await readStoredSessions(store, USER)).toBe(first);
    expect(getItem).not.toHaveBeenCalled();
    // An unchanged raw value reuses the parsed list.
    expect(await readStoredSessions(store, USER, true)).toBe(first);
    expect(getItem).toHaveBeenCalledTimes(1);
  });

  it("never serves one user's cached list for another user", async () => {
    await AsyncStorage.setItem(getSavedSessionsKey(USER), JSON.stringify([session()]));
    const { store, state } = makeStore();
    await readStoredSessions(store, USER);
    state.active = OTHER;
    expect(await readStoredSessions(store, OTHER)).toEqual([]);
    expect(store.cache.owner).toBe(OTHER);
  });

  it("does not cache a read for a user who is no longer active", async () => {
    await AsyncStorage.setItem(getSavedSessionsKey(USER), JSON.stringify([session()]));
    const { store } = makeStore(OTHER);
    expect(await readStoredSessions(store, USER)).toHaveLength(1);
    expect(store.cache.owner).toBeNull();
  });

  it("writes, caches and publishes, and skips an identical rewrite", async () => {
    const { store, published } = makeStore();
    await commitStoredSessions(store, USER, [session()]);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(getSavedSessionsKey(USER))).toBe(JSON.stringify([session()]));
    await commitStoredSessions(store, USER, [session()]);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(published).toHaveLength(2);
  });

  it("does nothing for a user who is not active", async () => {
    const { store, published } = makeStore(OTHER);
    await commitStoredSessions(store, USER, [session()]);
    await commitStoredSessions(store, null, [session()]);
    expect(setItem).not.toHaveBeenCalled();
    expect(published).toEqual([]);
  });
});

describe("removeStoredSessions", () => {
  it("removes the key and publishes an empty list for the active user", async () => {
    await AsyncStorage.setItem(getSavedSessionsKey(USER), JSON.stringify([session()]));
    const { store, published } = makeStore();
    await removeStoredSessions(store, USER);
    expect(await AsyncStorage.getItem(getSavedSessionsKey(USER))).toBeNull();
    expect(store.cache).toEqual({ owner: USER, raw: null, sessions: [] });
    expect(published).toEqual([[]]);
  });
});

describe("reloadStoredSessionsFallback", () => {
  it("publishes the stored list", async () => {
    await AsyncStorage.setItem(getSavedSessionsKey(USER), JSON.stringify([session()]));
    const { store, published } = makeStore();
    await reloadStoredSessionsFallback(store, USER);
    expect(published).toEqual([[session()]]);
    expect(store.cache.owner).toBe(USER);
  });

  it("publishes an empty list when storage fails", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    getItem.mockRejectedValueOnce(new Error("disk"));
    const { store, published } = makeStore();
    await reloadStoredSessionsFallback(store, USER);
    expect(published).toEqual([[]]);
    errorSpy.mockRestore();
  });

  it("does not blank another user's list when the read fails after a switch", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    getItem.mockRejectedValueOnce(new Error("disk"));
    const { store, published } = makeStore("user_2");
    await reloadStoredSessionsFallback(store, USER);
    expect(published).toEqual([]);
    errorSpy.mockRestore();
  });
});

describe("clearSavedSessionsCache", () => {
  it("forgets the list and its owner", () => {
    const cache = { owner: USER, raw: "[]", sessions: [session()] };
    clearSavedSessionsCache(cache);
    expect(cache).toEqual({ owner: null, raw: null, sessions: [] });
  });
});
