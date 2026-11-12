import AsyncStorage from "@react-native-async-storage/async-storage";
import { findAthleteNamesWithoutHistory, getAllCachedLiftingResultsForAthlete, saveAthleteHistoryBatch } from "@/lib/database/athlete-history-store";
import { getMeetLiftingResults } from "@/lib/database/meet-data-reads";
import { initStore } from "@/lib/database/offline-store-index";
import { saveMeetLiftingResults } from "@/lib/database/meet-data-saves";
import { itemAt } from "@/test-support/checked-access";

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
    multiSet: jest.fn(async (entries: [string, string][]) => {
      entries.forEach(([key, value]) => mockStorage.set(key, value));
    }),
    multiGet: jest.fn(async (keys: string[]) =>
      keys.map((key) => [key, mockStorage.get(key) ?? null]),
    ),
    multiRemove: jest.fn(async (keys: string[]) => {
      keys.forEach((key) => mockStorage.delete(key));
    }),
    getAllKeys: jest.fn(async () => Array.from(mockStorage.keys())),
  },
}));

describe("cached lifting result row validation", () => {
  beforeEach(async () => {
    mockStorage.clear();
    await initStore();
  });

  it("reads rows an older build stored with an id as today's rows, so they compare equal to a fresh answer", async () => {
    const fresh = { event_id: "evt", meet: "Meet A", date: "2025-01-01", name: "Jane Doe" };
    await saveMeetLiftingResults("Meet A", [{ id: 41001, ...fresh }] as any);

    await expect(getMeetLiftingResults("Meet A")).resolves.toEqual([fresh]);
  });

  it("drops corrupt rows from a cached results payload instead of throwing", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const good = { event_id: "evt", meet: "Meet A", date: "2025-01-01", name: "Jane Doe" };
    await saveMeetLiftingResults("Meet A", [good, null, 42, "nope", { date: "2025-01-01" }] as any);

    await expect(getMeetLiftingResults("Meet A")).resolves.toEqual([good]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Dropped 4 malformed"));
    warn.mockRestore();
  });

  it("treats an empty event_id as no id when de-duplicating across meets", async () => {
    await saveMeetLiftingResults("Meet A", [
      { id: 1, event_id: "", meet: "Meet A", date: "2025-01-01", name: "Jane Doe" } as any,
    ]);
    await saveMeetLiftingResults("Meet B", [
      { id: 2, event_id: "", meet: "Meet B", date: "2025-01-01", name: "Jane Doe" } as any,
    ]);

    const results = await getAllCachedLiftingResultsForAthlete("Jane Doe");
    expect(results.map((r) => r.meet).sort()).toEqual(["Meet A", "Meet B"]);
  });
});

describe("lifting results manifest bounds", () => {
  const HISTORY_KEY = "meetcal_athlete_history_jane doe";

  beforeEach(() => {
    mockStorage.clear();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ["an absurd chunk count", 1e9],
    ["an infinite chunk count", "Infinity"],
    ["a fractional chunk count", 1.5],
    ["a negative chunk count", -3],
  ])("reads %s as no cached history without allocating per chunk", async (_label, chunks) => {
    const multiGet = AsyncStorage.multiGet as jest.Mock;
    multiGet.mockClear();
    mockStorage.set(
      HISTORY_KEY,
      `{"format":"deflate-base64-chunks-v1","chunks":${chunks === "Infinity" ? "1e400" : chunks}}`,
    );

    await expect(getAllCachedLiftingResultsForAthlete("Jane Doe")).resolves.toEqual([]);
    const chunkReads = multiGet.mock.calls.filter(([keys]) =>
      (keys as string[]).some((key) => key.includes("__chunk_")),
    );
    expect(chunkReads).toHaveLength(0);
  });

  it("replaces a corrupt manifest without iterating its chunk count", async () => {
    const multiRemove = AsyncStorage.multiRemove as jest.Mock;
    multiRemove.mockClear();
    mockStorage.set(HISTORY_KEY, '{"format":"deflate-base64-chunks-v1","chunks":1000000000}');

    await saveAthleteHistory("Jane Doe", [
      { name: "Jane Doe", meet: "M", date: "2026-01-01", total: 200 } as never,
    ]);

    expect(multiRemove).not.toHaveBeenCalled();
    await expect(getAllCachedLiftingResultsForAthlete("Jane Doe")).resolves.toEqual([
      expect.objectContaining({ name: "Jane Doe", total: 200 }),
    ]);
  });
});

describe("batched athlete history writes", () => {
  const HISTORY_PREFIX = "meetcal_athlete_history_";
  const row = (name: string, date: string, total = 200) =>
    ({ id: 1, event_id: "evt", meet: "Meet A", date, name, total }) as any;
  const entries = (count: number, date = "2025-01-01") =>
    Array.from({ length: count }, (_, i) => ({
      name: `Athlete ${i + 1}`,
      results: [row(`Athlete ${i + 1}`, date)],
    }));
  const writeCalls = () => ({
    multiSet: (AsyncStorage.multiSet as jest.Mock).mock.calls.length,
    multiRemove: (AsyncStorage.multiRemove as jest.Mock).mock.calls.length,
    setItem: (AsyncStorage.setItem as jest.Mock).mock.calls.length,
    removeItem: (AsyncStorage.removeItem as jest.Mock).mock.calls.length,
  });
  const historyKeys = () =>
    Array.from(mockStorage.keys()).filter((k) => k.startsWith(HISTORY_PREFIX)).sort();

  beforeEach(async () => {
    mockStorage.clear();
    await initStore();
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("writes a 40-athlete batch with one multiSet, no setItem and no per-athlete remove", async () => {
    await expect(saveAthleteHistoryBatch(entries(40))).resolves.toBe(40);

    expect(writeCalls()).toEqual({ multiSet: 1, multiRemove: 0, setItem: 0, removeItem: 0 });
    expect(historyKeys()).toHaveLength(80);
    await expect(getAllCachedLiftingResultsForAthlete("Athlete 40")).resolves.toEqual([
      expect.objectContaining({ name: "Athlete 40", date: "2025-01-01" }),
    ]);
  });

  it("writes nothing at all when the batch is byte-identical to what is stored", async () => {
    await saveAthleteHistoryBatch(entries(40));
    jest.clearAllMocks();

    await expect(saveAthleteHistoryBatch(entries(40))).resolves.toBe(0);

    expect(writeCalls()).toEqual({ multiSet: 0, multiRemove: 0, setItem: 0, removeItem: 0 });
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });

  it("rewrites only the athletes whose history changed, in one multiSet and one multiRemove", async () => {
    await saveAthleteHistoryBatch(entries(40));
    jest.clearAllMocks();

    const changed = entries(40);
    changed[4] = { name: "Athlete 5", results: [row("Athlete 5", "2026-02-01")] };
    changed[9] = { name: "Athlete 10", results: [row("Athlete 10", "2026-02-01")] };
    await expect(saveAthleteHistoryBatch(changed)).resolves.toBe(2);

    expect(writeCalls()).toEqual({ multiSet: 1, multiRemove: 1, setItem: 0, removeItem: 0 });
    const [pairs] = (AsyncStorage.multiSet as jest.Mock).mock.calls[0];
    expect(pairs.map(([key]: [string, string]) => key)).toEqual([
      `${HISTORY_PREFIX}athlete 5__chunk_0_g1`,
      `${HISTORY_PREFIX}athlete 10__chunk_0_g1`,
      `${HISTORY_PREFIX}athlete 5`,
      `${HISTORY_PREFIX}athlete 10`,
    ]);
    expect((AsyncStorage.multiRemove as jest.Mock).mock.calls[0][0]).toEqual([
      `${HISTORY_PREFIX}athlete 5__chunk_0`,
      `${HISTORY_PREFIX}athlete 10__chunk_0`,
    ]);
    expect(historyKeys()).toHaveLength(80);
    await expect(getAllCachedLiftingResultsForAthlete("Athlete 5")).resolves.toEqual([
      expect.objectContaining({ date: "2026-02-01" }),
    ]);
    await expect(getAllCachedLiftingResultsForAthlete("Athlete 6")).resolves.toEqual([
      expect.objectContaining({ date: "2025-01-01" }),
    ]);
  });

  it("removes the old chunks only after the new manifest is written", async () => {
    await saveAthleteHistory("Jane Doe", [row("Jane Doe", "2025-01-01")]);
    jest.clearAllMocks();

    await saveAthleteHistory("Jane Doe", [row("Jane Doe", "2026-01-01")]);

    const multiSetOrder = itemAt((AsyncStorage.multiSet as jest.Mock).mock.invocationCallOrder, 0);
    const multiRemoveOrder = itemAt((AsyncStorage.multiRemove as jest.Mock).mock.invocationCallOrder, 0);
    expect(multiSetOrder).toBeLessThan(multiRemoveOrder);
    const manifest = JSON.parse(mockStorage.get(`${HISTORY_PREFIX}jane doe`) ?? "null");
    expect(manifest).toEqual({ format: "deflate-base64-chunks-v1", chunks: 1, generation: 1 });
    expect(historyKeys()).toEqual([
      `${HISTORY_PREFIX}jane doe`,
      `${HISTORY_PREFIX}jane doe__chunk_0_g1`,
    ]);
  });

  it("keeps the previous copy readable when the batch write is rejected", async () => {
    await saveAthleteHistoryBatch(entries(3));
    const before = new Map(mockStorage);
    jest.clearAllMocks();
    (AsyncStorage.multiSet as jest.Mock).mockRejectedValueOnce(new Error("SQLITE_FULL"));

    await expect(saveAthleteHistoryBatch(entries(3, "2026-06-01"))).rejects.toThrow("SQLITE_FULL");

    for (const [key, value] of before) {
      expect(mockStorage.get(key)).toBe(value);
    }
    expect(AsyncStorage.multiRemove).not.toHaveBeenCalled();
    for (const name of ["Athlete 1", "Athlete 2", "Athlete 3"]) {
      await expect(getAllCachedLiftingResultsForAthlete(name)).resolves.toEqual([
        expect.objectContaining({ name, date: "2025-01-01" }),
      ]);
    }
  });

  it("restores the previous manifest when a chunk did not persist", async () => {
    await saveAthleteHistory("Jane Doe", [row("Jane Doe", "2025-01-01")]);
    const previousManifest = mockStorage.get(`${HISTORY_PREFIX}jane doe`);
    (AsyncStorage.multiSet as jest.Mock).mockImplementationOnce(
      async (pairs: [string, string][]) => {
        pairs
          .filter(([key]) => !key.includes("__chunk_"))
          .forEach(([key, value]) => mockStorage.set(key, value));
      },
    );

    await expect(
      saveAthleteHistory("Jane Doe", [row("Jane Doe", "2026-01-01")]),
    ).rejects.toThrow(/Chunk 0 failed to persist/);

    expect(mockStorage.get(`${HISTORY_PREFIX}jane doe`)).toBe(previousManifest);
    await expect(getAllCachedLiftingResultsForAthlete("Jane Doe")).resolves.toEqual([
      expect.objectContaining({ date: "2025-01-01" }),
    ]);
  });

  it("does not leave a manifest behind when a first write is rejected", async () => {
    (AsyncStorage.multiSet as jest.Mock).mockRejectedValueOnce(new Error("SQLITE_FULL"));

    await expect(saveAthleteHistory("New Athlete", [row("New Athlete", "2026-01-01")])).rejects.toThrow();

    await expect(findAthleteNamesWithoutHistory(["New Athlete"])).resolves.toEqual(["New Athlete"]);
  });

  it("puts legacy rows back when a chunk fails but the new manifest lands", async () => {
    const legacy = JSON.stringify([row("Jane Doe", "2024-01-01")]);
    mockStorage.set(`${HISTORY_PREFIX}jane doe`, legacy);
    (AsyncStorage.multiSet as jest.Mock).mockImplementationOnce(
      async (pairs: [string, string][]) => {
        pairs
          .filter(([key]) => !key.includes("__chunk_"))
          .forEach(([key, value]) => mockStorage.set(key, value));
        throw new Error("SQLITE_FULL");
      },
    );

    await expect(
      saveAthleteHistory("Jane Doe", [row("Jane Doe", "2026-01-01")]),
    ).rejects.toThrow("SQLITE_FULL");

    expect(mockStorage.get(`${HISTORY_PREFIX}jane doe`)).toBe(legacy);
    await expect(getAllCachedLiftingResultsForAthlete("Jane Doe")).resolves.toEqual([
      expect.objectContaining({ date: "2024-01-01" }),
    ]);
  });

  it("does not prune another athlete's manifest whose key reads as a chunk key", async () => {
    await saveAthleteHistory("a__chunk_1", [row("a__chunk_1", "2025-01-01")]);
    mockStorage.set(`${HISTORY_PREFIX}a`, JSON.stringify([row("a", "2024-01-01")]));

    await saveAthleteHistory("a", [row("a", "2026-01-01")]);

    await expect(getAllCachedLiftingResultsForAthlete("a__chunk_1")).resolves.toEqual([
      expect.objectContaining({ date: "2025-01-01" }),
    ]);
    await expect(getAllCachedLiftingResultsForAthlete("a")).resolves.toEqual([
      expect.objectContaining({ date: "2026-01-01" }),
    ]);
  });

  it("wraps a chunk generation past the largest a manifest can name", async () => {
    const max = Number.MAX_SAFE_INTEGER;
    await saveAthleteHistory("Jane Doe", [row("Jane Doe", "2025-01-01")]);
    mockStorage.set(
      `${HISTORY_PREFIX}jane doe`,
      `{"format":"deflate-base64-chunks-v1","chunks":1,"generation":${max}}`,
    );
    mockStorage.set(
      `${HISTORY_PREFIX}jane doe__chunk_0_g${max}`,
      mockStorage.get(`${HISTORY_PREFIX}jane doe__chunk_0`) ?? "",
    );
    mockStorage.delete(`${HISTORY_PREFIX}jane doe__chunk_0`);
    mockStorage.set(`${HISTORY_PREFIX}john roe`, JSON.stringify([row("John Roe", "2024-01-01")]));
    mockStorage.set(`${HISTORY_PREFIX}john roe__chunk_0_g${max}`, "orphan");

    await saveAthleteHistoryBatch([
      { name: "Jane Doe", results: [row("Jane Doe", "2026-01-01")] },
      { name: "John Roe", results: [row("John Roe", "2026-01-01")] },
    ]);

    for (const name of ["Jane Doe", "John Roe"]) {
      await expect(getAllCachedLiftingResultsForAthlete(name)).resolves.toEqual([
        expect.objectContaining({ date: "2026-01-01" }),
      ]);
    }
    expect(historyKeys()).toEqual([
      `${HISTORY_PREFIX}jane doe`,
      `${HISTORY_PREFIX}jane doe__chunk_0_g1`,
      `${HISTORY_PREFIX}john roe`,
      `${HISTORY_PREFIX}john roe__chunk_0_g1`,
    ]);
  });

  it("collapses two spellings of one name into a single write, the last winning", async () => {
    await saveAthleteHistoryBatch([
      { name: "Jane Doe", results: [row("Jane Doe", "2025-01-01")] },
      { name: "  jane   DOE ", results: [row("Jane Doe", "2026-01-01")] },
      { name: "   ", results: [row("", "2026-01-01")] },
    ]);

    expect(historyKeys()).toEqual([
      `${HISTORY_PREFIX}jane doe`,
      `${HISTORY_PREFIX}jane doe__chunk_0`,
    ]);
    await expect(getAllCachedLiftingResultsForAthlete("Jane Doe")).resolves.toEqual([
      expect.objectContaining({ date: "2026-01-01" }),
    ]);
  });

  it("still reads a pre-generation manifest and its `__chunk_<n>` keys", async () => {
    await saveAthleteHistory("Jane Doe", [row("Jane Doe", "2025-01-01")]);
    expect(mockStorage.get(`${HISTORY_PREFIX}jane doe`)).toBe(
      '{"format":"deflate-base64-chunks-v1","chunks":1}',
    );
    expect(mockStorage.has(`${HISTORY_PREFIX}jane doe__chunk_0`)).toBe(true);

    await expect(getAllCachedLiftingResultsForAthlete("Jane Doe")).resolves.toHaveLength(1);
  });

  it("rejects a manifest whose generation is not a non-negative integer", async () => {
    mockStorage.set(
      `${HISTORY_PREFIX}jane doe`,
      '{"format":"deflate-base64-chunks-v1","chunks":1,"generation":1.5}',
    );
    mockStorage.set(`${HISTORY_PREFIX}jane doe__chunk_0`, "irrelevant");

    await expect(getAllCachedLiftingResultsForAthlete("Jane Doe")).resolves.toEqual([]);
  });

  it("writes meet results through the same commit-point path", async () => {
    await saveMeetLiftingResults("Meet A", [row("Jane Doe", "2025-01-01")]);
    jest.clearAllMocks();

    await saveMeetLiftingResults("Meet A", [row("Jane Doe", "2025-01-01")]);
    expect(AsyncStorage.multiSet).not.toHaveBeenCalled();

    await saveMeetLiftingResults("Meet A", [row("Jane Doe", "2026-01-01")]);
    expect(AsyncStorage.multiSet).toHaveBeenCalledTimes(1);
    await expect(getMeetLiftingResults("Meet A" as never)).resolves.toEqual([
      expect.objectContaining({ date: "2026-01-01" }),
    ]);
  });
});
