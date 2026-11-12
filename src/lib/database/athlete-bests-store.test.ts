import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearAllAthleteHistory } from "@/lib/database/athlete-history-clears";
import { ATHLETE_BESTS_EMPTY_TTL_MS, ATHLETE_BESTS_TTL_MS, getStoredAthleteBestsForNames, isAthleteBestsFresh, saveAthleteBestsBatch } from "@/lib/database/athlete-bests-store";

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

describe("cached athlete bests", () => {
  const NOW = Date.UTC(2026, 5, 20, 12);

  beforeEach(() => {
    mockStorage.clear();
  });

  it("round-trips bests under the normalized name and skips blank names", async () => {
    await saveAthleteBestsBatch(
      {
        "  Jane   Doe ": { snatch_best: 90, cj_best: 110, total: 200 },
        "   ": { snatch_best: 1, cj_best: 1, total: 2 },
      },
      NOW,
    );

    const [written] = (AsyncStorage.setMany as jest.Mock).mock.lastCall;
    expect(Object.keys(written)).toEqual([expect.stringContaining("jane doe")]);
    await expect(getStoredAthleteBestsForNames(["jane doe", "Nobody"], NOW)).resolves.toEqual({
      "jane doe": {
        bests: { snatch_best: 90, cj_best: 110, total: 200 },
        fetchedAt: NOW,
        isFresh: true,
      },
    });
  });

  it("expires real bests after a week and \"no results\" after a day", async () => {
    await saveAthleteBestsBatch(
      {
        Lifter: { snatch_best: 90, cj_best: 110, total: 200 },
        Newcomer: { snatch_best: null, cj_best: null, total: null },
      },
      NOW,
    );

    const at = async (now: number) => {
      const stored = await getStoredAthleteBestsForNames(["Lifter", "Newcomer"], now);
      return { lifter: stored.Lifter?.isFresh, newcomer: stored.Newcomer?.isFresh };
    };
    await expect(at(NOW + ATHLETE_BESTS_EMPTY_TTL_MS - 1)).resolves.toEqual({
      lifter: true,
      newcomer: true,
    });
    await expect(at(NOW + ATHLETE_BESTS_EMPTY_TTL_MS)).resolves.toEqual({
      lifter: true,
      newcomer: false,
    });
    await expect(at(NOW + ATHLETE_BESTS_TTL_MS)).resolves.toEqual({
      lifter: false,
      newcomer: false,
    });
    const expired = await getStoredAthleteBestsForNames(["Lifter"], NOW + ATHLETE_BESTS_TTL_MS);
    expect(expired.Lifter?.bests).toEqual({ snatch_best: 90, cj_best: 110, total: 200 });
  });

  it("reads an entry stored before bests carried a time as always stale", async () => {
    mockStorage.set(
      "meetcal_athlete_bests_jane doe",
      JSON.stringify({ snatch_best: null, cj_best: null, total: null }),
    );
    mockStorage.set(
      "meetcal_athlete_bests_john roe",
      JSON.stringify({ snatch_best: 80, cj_best: 100, total: 180 }),
    );

    await expect(getStoredAthleteBestsForNames(["Jane Doe", "John Roe"], NOW)).resolves.toEqual({
      "Jane Doe": {
        bests: { snatch_best: null, cj_best: null, total: null },
        fetchedAt: 0,
        isFresh: false,
      },
      "John Roe": {
        bests: { snatch_best: 80, cj_best: 100, total: 180 },
        fetchedAt: 0,
        isFresh: false,
      },
    });
  });

  it("treats a fetch time in the future (clock moved back) as stale", () => {
    const bests = { snatch_best: 90, cj_best: 110, total: 200 };
    expect(isAthleteBestsFresh(bests, NOW + 60_000, NOW)).toBe(false);
    expect(isAthleteBestsFresh(bests, NOW, NOW)).toBe(true);
    expect(isAthleteBestsFresh(bests, 0, NOW)).toBe(false);
  });

  it("reads corrupt or mistyped blobs as missing or null, never as numbers", async () => {
    await saveAthleteBestsBatch({ "Jane Doe": { snatch_best: 90, cj_best: 110, total: 200 } }, NOW);
    const key = Array.from(mockStorage.keys()).find((k) => k.includes("jane doe"))!;

    mockStorage.set(key, "{truncated");
    await expect(getStoredAthleteBestsForNames(["Jane Doe"], NOW)).resolves.toEqual({});

    mockStorage.set(
      key,
      JSON.stringify({ v: 2, fetchedAt: NOW, bests: { snatch_best: "90", cj_best: null, total: 200 } }),
    );
    await expect(getStoredAthleteBestsForNames(["Jane Doe"], NOW)).resolves.toEqual({
      "Jane Doe": {
        bests: { snatch_best: null, cj_best: null, total: 200 },
        fetchedAt: NOW,
        isFresh: true,
      },
    });

    mockStorage.set(key, JSON.stringify({ v: 2, fetchedAt: "yesterday", bests: null }));
    await expect(getStoredAthleteBestsForNames(["Jane Doe"], NOW)).resolves.toEqual({});
  });

  it("writes a roster-sized bests map in bounded setMany batches", async () => {
    const setMany = AsyncStorage.setMany as jest.Mock;
    setMany.mockClear();
    const bests = Object.fromEntries(
      Array.from({ length: 1201 }, (_, i) => [
        `Athlete ${i}`,
        { snatch_best: 90, cj_best: 110, total: 200 },
      ]),
    );

    await saveAthleteBestsBatch(bests, NOW);

    expect(setMany.mock.calls.map(([entries]) => Object.keys(entries).length)).toEqual([
      500, 500, 201,
    ]);
    await expect(getStoredAthleteBestsForNames(["Athlete 1200"], NOW)).resolves.toEqual({
      "Athlete 1200": {
        bests: { snatch_best: 90, cj_best: 110, total: 200 },
        fetchedAt: NOW,
        isFresh: true,
      },
    });
  });

  it("reads a roster-sized name list in bounded getMany batches", async () => {
    const getMany = AsyncStorage.getMany as jest.Mock;
    getMany.mockClear();
    const names = Array.from({ length: 1201 }, (_, i) => `Athlete ${i}`);

    await getStoredAthleteBestsForNames(names, NOW);

    expect(getMany.mock.calls.map(([keys]) => keys.length)).toEqual([500, 500, 201]);
  });

  it("does not write at all for an empty map", async () => {
    const setMany = AsyncStorage.setMany as jest.Mock;
    setMany.mockClear();
    await saveAthleteBestsBatch({});
    expect(setMany).not.toHaveBeenCalled();
  });

  it("returns an empty record when storage is unavailable", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    (AsyncStorage.getMany as jest.Mock).mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(getStoredAthleteBestsForNames(["Jane Doe"])).resolves.toEqual({});
  });

  it("is removed by clearAllAthleteHistory along with the history", async () => {
    await saveAthleteBestsBatch({ "Jane Doe": { snatch_best: 90, cj_best: 110, total: 200 } }, NOW);
    mockStorage.set("meetcal_schedule_Meet A", "[]");

    await clearAllAthleteHistory();

    expect(
      Array.from(mockStorage.keys()).filter((k) => k.startsWith("meetcal_athlete_bests_")),
    ).toEqual([]);
    expect(mockStorage.has("meetcal_schedule_Meet A")).toBe(true);
  });
});
