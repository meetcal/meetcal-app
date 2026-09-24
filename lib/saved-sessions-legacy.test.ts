import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  findLegacySessionsNeedingMigration,
  getLegacySavedSessionsKeys,
  removeLegacySavedSessionsKey,
  resetLegacySavedSessions,
} from "@/lib/saved-sessions-legacy";
import { getSavedSessionsKey } from "@/utils/session";

const USER = "user_1";
const PRIMARY = getSavedSessionsKey(USER);
const MEET = "Test Meet" as never;

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "old-id",
  sessionNumber: 1,
  platform: "Red",
  weightClass: "71kg",
  startTime: "10:00 AM",
  weighInTime: "8:00 AM",
  date: "2099-06-20",
  ...overrides,
});

beforeEach(async () => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("findLegacySessionsNeedingMigration", () => {
  it("returns only keys that hold a row without a meet, re-keyed to the current meet", async () => {
    const [legacyKey] = getLegacySavedSessionsKeys(USER);
    await AsyncStorage.setItem(PRIMARY, JSON.stringify([row({ meet: MEET, id: "Test-Meet-1-Red" })]));
    await AsyncStorage.setItem(legacyKey, JSON.stringify([row(), null, "junk", row({ meet: "" })]));

    const batches = await findLegacySessionsNeedingMigration(USER, MEET);

    expect(batches).toHaveLength(1);
    expect(batches[0].key).toBe(legacyKey);
    expect(batches[0].sessions.every((s) => s.meet === MEET)).toBe(true);
    expect(batches[0].sessions.map((s) => s.id)).toEqual(["Test-Meet-1-Red", "Test-Meet-1-Red"]);
  });

  it.each(["{", "{}", "null", '"x"'])("ignores malformed legacy storage %s", async (raw) => {
    const [legacyKey] = getLegacySavedSessionsKeys(USER);
    await AsyncStorage.setItem(legacyKey, raw);
    await expect(findLegacySessionsNeedingMigration(USER, MEET)).resolves.toEqual([]);
  });

  it("drops rows that have no session number or platform", async () => {
    const [legacyKey] = getLegacySavedSessionsKeys(USER);
    await AsyncStorage.setItem(
      legacyKey,
      JSON.stringify([{ id: "x" }, row({ platform: "" }), row({ sessionNumber: "2" })]),
    );
    await expect(findLegacySessionsNeedingMigration(USER, MEET)).resolves.toEqual([]);
  });
});

describe("removeLegacySavedSessionsKey", () => {
  it("removes a legacy key but never the primary key", async () => {
    const [legacyKey] = getLegacySavedSessionsKeys(USER);
    await AsyncStorage.setItem(PRIMARY, "[]");
    await AsyncStorage.setItem(legacyKey, "[]");

    await removeLegacySavedSessionsKey(USER, legacyKey);
    await removeLegacySavedSessionsKey(USER, PRIMARY);

    await expect(AsyncStorage.getItem(legacyKey)).resolves.toBeNull();
    await expect(AsyncStorage.getItem(PRIMARY)).resolves.toBe("[]");
  });
});

describe("resetLegacySavedSessions", () => {
  it("filters one meet out of every legacy key and leaves the primary key alone", async () => {
    const [a, b] = getLegacySavedSessionsKeys(USER);
    await AsyncStorage.setItem(PRIMARY, JSON.stringify([row({ meet: MEET })]));
    await AsyncStorage.setItem(a, JSON.stringify([row({ meet: MEET }), row({ meet: "Other" })]));
    await AsyncStorage.setItem(b, JSON.stringify([row({ meet: MEET })]));

    await resetLegacySavedSessions(USER, MEET);

    expect(JSON.parse((await AsyncStorage.getItem(a)) ?? "[]")).toEqual([row({ meet: "Other" })]);
    // Emptied entirely: the key goes rather than a stale `[]`.
    await expect(AsyncStorage.getItem(b)).resolves.toBeNull();
    expect(JSON.parse((await AsyncStorage.getItem(PRIMARY)) ?? "[]")).toHaveLength(1);
  });

  it("removes every legacy key for a reset of all meets", async () => {
    const keys = getLegacySavedSessionsKeys(USER);
    for (const key of keys) await AsyncStorage.setItem(key, "[]");
    await AsyncStorage.setItem(PRIMARY, "[]");

    await resetLegacySavedSessions(USER, null);

    for (const key of keys) await expect(AsyncStorage.getItem(key)).resolves.toBeNull();
    await expect(AsyncStorage.getItem(PRIMARY)).resolves.toBe("[]");
  });
});
