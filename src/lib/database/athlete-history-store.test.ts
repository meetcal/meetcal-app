import AsyncStorage from "@react-native-async-storage/async-storage";
import { getAllCachedLiftingResultsForAthlete, getAllCachedLiftingResultsForAthletes, saveAthleteHistoryBatch } from "@/lib/database/athlete-history-store";
import { initStore } from "@/lib/database/offline-store-index";
import { saveMeetLiftingResults } from "@/lib/database/meet-data-saves";

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

describe("getAllCachedLiftingResultsForAthletes", () => {
  const row = (overrides: Record<string, unknown>) =>
    ({
      id: 1,
      event_id: "evt",
      meet: "Meet A",
      date: "2026-01-01",
      name: "Jane Doe",
      age: 25,
      body_weight: 65,
      snatch1: 90,
      snatch2: null,
      snatch3: null,
      snatch_best: 90,
      cj1: 110,
      cj2: null,
      cj3: null,
      cj_best: 110,
      total: 200,
      ...overrides,
    }) as any;

  beforeEach(async () => {
    mockStorage.clear();
    jest.clearAllMocks();
    await initStore();
  });

  it("aggregates a name across every cached meet, newest date first", async () => {
    await saveMeetLiftingResults("Meet A", [
      row({ event_id: "a", meet: "Meet A", date: "2025-03-01" }),
      row({ event_id: "a", meet: "Meet A", date: "2025-03-01", name: "Other Person" }),
    ]);
    await saveMeetLiftingResults("Meet B", [
      row({ event_id: "b", meet: "Meet B", date: "2026-05-01" }),
    ]);

    const byName = await getAllCachedLiftingResultsForAthletes(["Jane Doe"]);

    expect(byName["Jane Doe"]?.map((r) => r.date)).toEqual([
      "2026-05-01",
      "2025-03-01",
    ]);
  });

  it("matches cached meet rows in another Unicode form to the requested name (#268)", async () => {
    const nfc = "José Núñez".normalize("NFC");
    const nfd = nfc.normalize("NFD");
    await saveMeetLiftingResults("Meet A", [row({ event_id: "a", name: nfc })]);

    const byName = await getAllCachedLiftingResultsForAthletes([nfd]);

    expect(byName[nfd]).toHaveLength(1);
  });

  it("matches names case-insensitively and with whitespace normalization", async () => {
    await saveMeetLiftingResults("Meet A", [
      row({ event_id: "a", name: "  JANE   DOE " }),
      row({ event_id: "a", name: "jane doe" }),
    ]);

    const byName = await getAllCachedLiftingResultsForAthletes(["Jane Doe"]);

    expect(byName["Jane Doe"]).toHaveLength(2);
  });

  it("de-duplicates the same row cached under two meets", async () => {
    const shared = row({ event_id: "shared", meet: "Meet A", date: "2025-03-01" });
    await saveMeetLiftingResults("Meet A", [shared]);
    await saveMeetLiftingResults("Meet B", [shared]);

    const byName = await getAllCachedLiftingResultsForAthletes(["Jane Doe"]);

    expect(byName["Jane Doe"]).toHaveLength(1);
  });

  it("prefers the athlete's own history blob over the meet scan", async () => {
    await saveMeetLiftingResults("Meet A", [row({ date: "2020-01-01" })]);
    await saveAthleteHistory("Jane Doe", [
      row({ event_id: "hist", meet: "History Meet", date: "2026-09-01" }),
    ]);

    const byName = await getAllCachedLiftingResultsForAthletes(["Jane Doe"]);

    expect(byName["Jane Doe"]).toHaveLength(1);
    expect(byName["Jane Doe"]?.[0]?.meet).toBe("History Meet");
  });

  it("returns the same rows as the single-athlete helper", async () => {
    await saveMeetLiftingResults("Meet A", [
      row({ event_id: "a", date: "2025-03-01" }),
    ]);
    await saveMeetLiftingResults("Meet B", [
      row({ event_id: "b", meet: "Meet B", date: "2026-05-01" }),
      row({ event_id: "b", meet: "Meet B", name: "John Doe" }),
    ]);

    const batch = await getAllCachedLiftingResultsForAthletes([
      "Jane Doe",
      "John Doe",
      "Nobody At All",
    ]);

    await expect(
      getAllCachedLiftingResultsForAthlete("Jane Doe"),
    ).resolves.toEqual(batch["Jane Doe"]);
    await expect(
      getAllCachedLiftingResultsForAthlete("John Doe"),
    ).resolves.toEqual(batch["John Doe"]);
    expect(batch["Nobody At All"]).toEqual([]);
  });

  it("reads each meet's results blob once for the whole batch", async () => {
    await saveMeetLiftingResults("Meet A", [
      row({ event_id: "a", name: "Jane Doe" }),
      row({ event_id: "a", name: "John Doe" }),
      row({ event_id: "a", name: "Jo Doe" }),
    ]);
    await saveMeetLiftingResults("Meet B", [
      row({ event_id: "b", meet: "Meet B", name: "Jane Doe" }),
    ]);

    jest.clearAllMocks();
    await getAllCachedLiftingResultsForAthletes([
      "Jane Doe",
      "John Doe",
      "Jo Doe",
    ]);

    const manifestReads = (AsyncStorage.getItem as jest.Mock).mock.calls.filter(
      ([key]: [string]) =>
        typeof key === "string" &&
        key.startsWith("meetcal_lifting_results_") &&
        !key.includes("__chunk_"),
    );
    expect(manifestReads).toHaveLength(2);
  });

  it("returns an empty record for an empty name list without touching storage", async () => {
    jest.clearAllMocks();
    await expect(getAllCachedLiftingResultsForAthletes([])).resolves.toEqual({});
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });
});
