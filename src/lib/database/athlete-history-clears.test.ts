import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearAllAthleteHistory, pruneOrphanedAthleteHistory } from "@/lib/database/athlete-history-clears";
import { clearAllMeetData, clearMeetData } from "@/lib/database/meet-data-clears";
import { clearExpiredDownloadedMeets } from "@/lib/database/downloaded-meet-expiry";
import { findAthleteNamesWithoutHistory, getAllCachedLiftingResultsForAthlete, saveAthleteHistoryBatch } from "@/lib/database/athlete-history-store";
import { PACKAGE_ETAG_STORAGE_KEY } from "@/lib/database/package-etags";
import { getStoredAthleteBestsForNames, saveAthleteBestsBatch } from "@/lib/database/athlete-bests-store";
import { markMeetExplicitlyDownloaded } from "@/lib/database/meet-downloads-registry";
import { getMeetData } from "@/lib/database/meet-data-reads";
import { initStore } from "@/lib/database/offline-store-index";
import { saveMeetAthletes, saveMeetLiftingResults } from "@/lib/database/meet-data-saves";
import { normalizeAthleteName } from "@/lib/athletes";

const saveAthleteHistory = (name: string, results: Parameters<typeof saveAthleteHistoryBatch>[0][number]["results"]) =>
  saveAthleteHistoryBatch([{ name, results }]);

const mockStorage = new Map<string, string>();

let mockTrustedNow: () => Date | null = () => new Date();

jest.mock("@/lib/api/server-clock", () => ({
  getTrustedNow: () => mockTrustedNow(),
}));

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStorage.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStorage.delete(key);
    }),
    setMany: jest.fn(async (entries: Record<string, string>) => {
      Object.entries(entries).forEach(([key, value]) => mockStorage.set(key, value));
    }),
    getMany: jest.fn(async (keys: string[]) =>
      Object.fromEntries(keys.map((key) => [key, mockStorage.get(key) ?? null])),
    ),
    removeMany: jest.fn(async (keys: string[]) => {
      keys.forEach((key) => mockStorage.delete(key));
    }),
    getAllKeys: jest.fn(async () => Array.from(mockStorage.keys())),
  },
}));

describe("clearAllAthleteHistory", () => {
  beforeEach(async () => {
    mockStorage.clear();
    await initStore();
  });

  const row = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 1,
      event_id: "evt",
      meet: "Meet A",
      date: "2025-01-01",
      name: "Jane Doe",
      age: 25,
      body_weight: 65,
      snatch1: 90,
      snatch2: 95,
      snatch3: null,
      snatch_best: 95,
      cj1: 110,
      cj2: 115,
      cj3: null,
      cj_best: 115,
      total: 210,
      ...overrides,
    }) as any;

  it("removes every athlete history key without a read per athlete", async () => {
    const names = Array.from({ length: 12 }, (_, i) => `Athlete ${i}`);
    for (const name of names) {
      await saveAthleteHistory(name, [row({ name })]);
    }

    jest.clearAllMocks();
    await clearAllAthleteHistory();

    expect(AsyncStorage.getAllKeys).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
    expect(AsyncStorage.removeMany).toHaveBeenCalledTimes(1);

    const leftovers = (await AsyncStorage.getAllKeys()).filter((k) =>
      k.startsWith("meetcal_athlete_history_"),
    );
    expect(leftovers).toEqual([]);
  });

  it("reaps chunk keys orphaned by an interrupted write", async () => {
    await saveAthleteHistory("Jane Doe", [row()]);
    mockStorage.set("meetcal_athlete_history_jane doe__chunk_7", "orphan");
    mockStorage.delete("meetcal_athlete_history_jane doe");

    await clearAllAthleteHistory();

    expect(
      (await AsyncStorage.getAllKeys()).filter((k) =>
        k.startsWith("meetcal_athlete_history_"),
      ),
    ).toEqual([]);
  });

  it("leaves meet-scoped lifting results alone", async () => {
    await saveMeetLiftingResults("Meet A", [row()]);
    await saveAthleteHistory("Jane Doe", [row()]);

    await clearAllAthleteHistory();

    expect(
      (await AsyncStorage.getAllKeys()).some((k) =>
        k.startsWith("meetcal_lifting_results_"),
      ),
    ).toBe(true);
  });

  it("drops the package validators that vouched for the deleted history", async () => {
    mockStorage.set(PACKAGE_ETAG_STORAGE_KEY, JSON.stringify({ "Meet A": '"abc"' }));
    await saveAthleteHistory("Jane Doe", [row()]);

    await clearAllAthleteHistory();

    expect(mockStorage.has(PACKAGE_ETAG_STORAGE_KEY)).toBe(false);
  });

  it("reports which athletes have no history blob, reading manifests only", async () => {
    await saveAthleteHistory("Jane Doe", [row()]);
    jest.clearAllMocks();

    await expect(
      findAthleteNamesWithoutHistory(["Jane Doe", "  jane   DOE ", "John Smith", ""]),
    ).resolves.toEqual(["John Smith"]);
    expect(AsyncStorage.getMany).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
    await expect(findAthleteNamesWithoutHistory([])).resolves.toEqual([]);
  });
});

describe("athlete history pruning", () => {
  const HISTORY_PREFIX = "meetcal_athlete_history_";
  const BESTS_PREFIX = "meetcal_athlete_bests_";
  const row = (name: string) =>
    ({ id: 1, event_id: "evt", meet: "Meet A", date: "2025-01-01", name, total: 200 }) as any;
  const athlete = (meet: string, name: string) => ({
    memberId: `${meet}-${name}`,
    name,
    age: 25,
    club: "Club",
    gender: "Women",
    weightClass: "71kg",
    entryTotal: 200,
    adaptive: false,
  });
  const keysFor = (name: string) =>
    Array.from(mockStorage.keys()).filter(
      (k) => k.startsWith(`${HISTORY_PREFIX}${name}`) || k === `${BESTS_PREFIX}${name}`,
    );

  beforeEach(async () => {
    mockStorage.clear();
    await initStore();
  });

  it("drops the history of athletes only the expired meet held and keeps shared athletes", async () => {
    await saveMeetAthletes("Expired", [athlete("Expired", "Only Expired"), athlete("Expired", "Shared")] as never);
    await saveMeetAthletes("Kept", [athlete("Kept", "Shared"), athlete("Kept", "Only Kept")] as never);
    await saveAthleteHistoryBatch(
      ["Only Expired", "Shared", "Only Kept"].map((name) => ({ name, results: [row(name)] })),
    );
    await saveAthleteBestsBatch({
      "Only Expired": { snatch_best: 1, cj_best: 2, total: 3 },
      Shared: { snatch_best: 1, cj_best: 2, total: 3 },
    });
    await markMeetExplicitlyDownloaded("Expired" as never, true, { endDate: "2020-01-01" });
    await markMeetExplicitlyDownloaded("Kept" as never, true, { endDate: "2099-01-01" });

    await clearExpiredDownloadedMeets();

    expect(keysFor("only expired")).toEqual([]);
    expect(keysFor("shared").sort()).toEqual([
      `${BESTS_PREFIX}shared`,
      `${HISTORY_PREFIX}shared`,
      `${HISTORY_PREFIX}shared__chunk_0`,
    ]);
    expect(keysFor("only kept")).toHaveLength(2);
    await expect(getAllCachedLiftingResultsForAthlete("Shared")).resolves.toHaveLength(1);
    await expect(getMeetData("Kept" as never)).resolves.toMatchObject({
      athletes: [expect.objectContaining({ name: "Shared" }), expect.objectContaining({ name: "Only Kept" })],
    });
  });

  it("removes exclusive history in bounded removeMany batches", async () => {
    const names = Array.from({ length: 600 }, (_, i) => `Athlete ${i + 1}`);
    await saveMeetAthletes("Big", names.map((name) => athlete("Big", name)) as never);
    await saveAthleteHistoryBatch(names.map((name) => ({ name, results: [row(name)] })));
    jest.clearAllMocks();

    await clearMeetData("Big" as never);

    const removes = (AsyncStorage.removeMany as jest.Mock).mock.calls.map(([keys]) => keys.length);
    expect(Math.max(...removes)).toBeLessThanOrEqual(500);
    expect(Array.from(mockStorage.keys()).filter((k) => k.startsWith(HISTORY_PREFIX))).toEqual([]);
  });

  it("does not read other rosters when the cleared meet's athletes have no history", async () => {
    await saveMeetAthletes("Browsed", [athlete("Browsed", "Nobody")] as never);
    await saveMeetAthletes("Downloaded", [athlete("Downloaded", "Somebody")] as never);
    await saveAthleteHistory("Somebody", [row("Somebody")]);
    jest.clearAllMocks();

    await clearMeetData("Browsed" as never);

    const rosterReads = (AsyncStorage.getItem as jest.Mock).mock.calls.filter(
      ([key]) => key === "meetcal_athletes_Downloaded",
    );
    expect(rosterReads).toHaveLength(0);
    expect(keysFor("somebody")).toHaveLength(2);
  });

  it("skips per-meet pruning when every meet is being cleared", async () => {
    await saveMeetAthletes("A", [athlete("A", "One")] as never);
    await saveMeetAthletes("B", [athlete("B", "Two")] as never);
    await saveAthleteHistoryBatch([{ name: "One", results: [row("One")] }, { name: "Two", results: [row("Two")] }]);
    jest.clearAllMocks();

    await clearAllMeetData();

    expect(keysFor("one")).toHaveLength(2);
    expect(keysFor("two")).toHaveLength(2);
  });

  it("prunes history of athletes on no stored roster, keeping the caller's names", async () => {
    await saveMeetAthletes("Kept", [athlete("Kept", "On Roster")] as never);
    await saveAthleteHistoryBatch(
      ["On Roster", "Orphan", "Incoming"].map((name) => ({ name, results: [row(name)] })),
    );
    await saveAthleteBestsBatch({ Orphan: { snatch_best: 1, cj_best: 2, total: 3 } });
    mockStorage.set(`${HISTORY_PREFIX}orphan__chunk_3_g2`, "stale");
    jest.clearAllMocks();

    await expect(pruneOrphanedAthleteHistory({ keepNames: ["Incoming"] })).resolves.toBe(4);

    expect(keysFor("orphan")).toEqual([]);
    expect(keysFor("on roster")).toHaveLength(2);
    expect(keysFor("incoming")).toHaveLength(2);
    expect(AsyncStorage.getAllKeys).toHaveBeenCalledTimes(1);
  });

  it("returns 0 without reading rosters when no history is stored", async () => {
    await saveMeetAthletes("Kept", [athlete("Kept", "On Roster")] as never);
    jest.clearAllMocks();

    await expect(pruneOrphanedAthleteHistory()).resolves.toBe(0);

    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });

  it("stores history and bests for one athlete under one key, whichever Unicode form is used (#268)", async () => {
    const nfc = "José Núñez".normalize("NFC");
    const nfd = nfc.normalize("NFD");
    await saveAthleteHistoryBatch([{ name: nfd, results: [row(nfd)] }]);
    await saveAthleteBestsBatch({ [nfd]: { snatch_best: 1, cj_best: 2, total: 3 } });

    await expect(findAthleteNamesWithoutHistory([nfc])).resolves.toEqual([]);
    await expect(getAllCachedLiftingResultsForAthlete(nfc)).resolves.toHaveLength(1);
    const bests = await getStoredAthleteBestsForNames([nfc]);
    expect(bests[nfc]?.bests).toEqual({ snatch_best: 1, cj_best: 2, total: 3 });
    expect(keysFor("josé núñez".normalize("NFC")).sort()).toEqual([
      `${BESTS_PREFIX}josé núñez`.normalize("NFC"),
      `${HISTORY_PREFIX}josé núñez`.normalize("NFC"),
      `${HISTORY_PREFIX}josé núñez__chunk_0`.normalize("NFC"),
    ]);
  });

  it("reads history and bests stored under a name's older, non-NFC key (#268)", async () => {
    const nfd = "José Núñez".normalize("NFD");
    const newKey = normalizeAthleteName(nfd);
    const oldKey = nfd.toLowerCase();
    expect(oldKey).not.toBe(newKey);
    await saveAthleteHistoryBatch([{ name: nfd, results: [row(nfd)] }]);
    await saveAthleteBestsBatch({ [nfd]: { snatch_best: 1, cj_best: 2, total: 3 } });
    for (const prefix of [HISTORY_PREFIX, BESTS_PREFIX]) {
      for (const key of Array.from(mockStorage.keys())) {
        if (!key.startsWith(`${prefix}${newKey}`)) continue;
        mockStorage.set(`${prefix}${oldKey}${key.slice(`${prefix}${newKey}`.length)}`, mockStorage.get(key)!);
        mockStorage.delete(key);
      }
    }

    await expect(findAthleteNamesWithoutHistory([nfd, "Nobody"])).resolves.toEqual(["Nobody"]);
    await expect(getAllCachedLiftingResultsForAthlete(nfd)).resolves.toHaveLength(1);
    const bests = await getStoredAthleteBestsForNames([nfd]);
    expect(bests[nfd]?.bests).toEqual({ snatch_best: 1, cj_best: 2, total: 3 });
  });

  it("clears keys stored under a name's older, non-NFC key with the athlete (#268)", async () => {
    const nfc = "José Núñez".normalize("NFC");
    const oldKey = nfc.normalize("NFD").toLowerCase();
    await saveMeetAthletes("Browsed", [athlete("Browsed", nfc)] as never);
    mockStorage.set(`${HISTORY_PREFIX}${oldKey}`, "old manifest");
    mockStorage.set(`${HISTORY_PREFIX}${oldKey}__chunk_0`, "old chunk");
    mockStorage.set(`${BESTS_PREFIX}${oldKey}`, "old bests");
    await saveAthleteHistoryBatch([{ name: nfc, results: [row(nfc)] }]);

    await clearMeetData("Browsed" as never);

    expect(
      Array.from(mockStorage.keys()).filter(
        (k) => k.startsWith(HISTORY_PREFIX) || k.startsWith(BESTS_PREFIX),
      ),
    ).toEqual([]);
  });

  it("prunes the bests of athletes who have bests but no history", async () => {
    await saveMeetAthletes("Browsed", [athlete("Browsed", "Bests Only"), athlete("Browsed", "Shared")] as never);
    await saveMeetAthletes("Kept", [athlete("Kept", "Shared")] as never);
    await saveAthleteBestsBatch({
      "Bests Only": { snatch_best: 1, cj_best: 2, total: 3 },
      Shared: { snatch_best: 1, cj_best: 2, total: 3 },
      Orphan: { snatch_best: 1, cj_best: 2, total: 3 },
    });

    await clearMeetData("Browsed" as never);

    expect(keysFor("bests only")).toEqual([]);
    expect(keysFor("shared")).toEqual([`${BESTS_PREFIX}shared`]);

    await expect(pruneOrphanedAthleteHistory()).resolves.toBe(1);
    expect(keysFor("orphan")).toEqual([]);
    expect(keysFor("shared")).toEqual([`${BESTS_PREFIX}shared`]);
  });
});
