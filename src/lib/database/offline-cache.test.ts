import {
  BROWSE_CACHE_KEYS,
  clearBrowseCaches,
  getOfflineCache,
  OFFLINE_CACHE_KEYS,
  readBoundedCacheEntry,
  removeBoundedCacheEntry,
  setOfflineCache,
  writeBoundedCacheEntry,
} from "@/lib/database/offline-cache";

const mockMemory = new Map<string, string>();
/**
 * While set, a read takes its value when it is issued but resolves only once
 * the gate opens: a read-modify-write still parsing an old copy.
 */
let mockReadGate: Promise<void> | null = null;

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key: string) => {
    const value = mockMemory.get(key) ?? null;
    if (mockReadGate) await mockReadGate;
    return value;
  }),
  setItem: jest.fn(async (key: string, value: string) => {
    mockMemory.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockMemory.delete(key);
  }),
}));

describe("offline cache", () => {
  beforeEach(() => {
    mockMemory.clear();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("round-trips a well-formed entry", async () => {
    await setOfflineCache("k", { rows: [1] });
    await expect(getOfflineCache("k")).resolves.toMatchObject({
      data: { rows: [1] },
    });
  });

  it("returns null for invalid JSON", async () => {
    mockMemory.set("k", "{nope");
    await expect(getOfflineCache("k")).resolves.toBeNull();
  });

  it("returns null when lastSynced is missing", async () => {
    mockMemory.set("k", JSON.stringify({ data: { rows: [] } }));
    await expect(getOfflineCache("k")).resolves.toBeNull();
  });

  it("returns null for an empty store", async () => {
    await expect(getOfflineCache("missing")).resolves.toBeNull();
  });
});

describe("bounded browse caches", () => {
  const KEY = "@offline_cache/bounded";

  beforeEach(() => {
    mockMemory.clear();
    mockReadGate = null;
    jest.spyOn(Date, "now").mockReturnValue(1000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("removes one entry, and the cache once it holds none", async () => {
    await writeBoundedCacheEntry(KEY, "a", "A", 5);
    await writeBoundedCacheEntry(KEY, "b", "B", 5);
    await removeBoundedCacheEntry(KEY, "a");
    await removeBoundedCacheEntry(KEY, "missing");
    await expect(readBoundedCacheEntry(KEY, "a")).resolves.toBeNull();
    await expect(readBoundedCacheEntry(KEY, "b")).resolves.toMatchObject({ data: "B" });
    await removeBoundedCacheEntry(KEY, "b");
    expect(mockMemory.has(KEY)).toBe(false);
  });

  it("keeps only the newest maxEntries writes; the oldest goes first", async () => {
    for (const [i, name] of ["a", "b", "c", "d"].entries()) {
      jest.mocked(Date.now).mockReturnValue(1000 + i);
      await writeBoundedCacheEntry(KEY, name, { name }, 3);
    }
    await expect(readBoundedCacheEntry(KEY, "a")).resolves.toBeNull();
    await expect(readBoundedCacheEntry(KEY, "b")).resolves.toEqual({
      data: { name: "b" },
      lastUpdatedAt: 1001,
    });
    await expect(readBoundedCacheEntry(KEY, "d")).resolves.toEqual({
      data: { name: "d" },
      lastUpdatedAt: 1003,
    });
  });

  it("a rewritten entry becomes the newest, and each entry keeps its own write time", async () => {
    await writeBoundedCacheEntry(KEY, "a", 1, 2);
    jest.mocked(Date.now).mockReturnValue(2000);
    await writeBoundedCacheEntry(KEY, "b", 2, 2);
    jest.mocked(Date.now).mockReturnValue(3000);
    await writeBoundedCacheEntry(KEY, "a", 3, 2);
    jest.mocked(Date.now).mockReturnValue(4000);
    await writeBoundedCacheEntry(KEY, "c", 4, 2);

    await expect(readBoundedCacheEntry(KEY, "b")).resolves.toBeNull();
    await expect(readBoundedCacheEntry(KEY, "a")).resolves.toEqual({ data: 3, lastUpdatedAt: 3000 });
    await expect(readBoundedCacheEntry(KEY, "c")).resolves.toEqual({ data: 4, lastUpdatedAt: 4000 });
  });

  it("rewriting an entry replaces its old copy instead of keeping both", async () => {
    await writeBoundedCacheEntry(KEY, "a", "v1", 5);
    await writeBoundedCacheEntry(KEY, "a", "v2", 5);

    await expect(readBoundedCacheEntry(KEY, "a")).resolves.toMatchObject({ data: "v2" });
    const stored = await getOfflineCache<unknown[]>(KEY);
    expect(stored?.data).toHaveLength(1);
  });

  it("reads and caps the unbounded object shape these keys held before", async () => {
    mockMemory.set(
      KEY,
      JSON.stringify({ data: { old1: [1], old2: [2], old3: [3] }, lastSynced: 50 }),
    );
    await expect(readBoundedCacheEntry(KEY, "old2")).resolves.toEqual({
      data: [2],
      lastUpdatedAt: 50,
    });
    await writeBoundedCacheEntry(KEY, "new", [4], 2);
    await expect(readBoundedCacheEntry(KEY, "old1")).resolves.toBeNull();
    await expect(readBoundedCacheEntry(KEY, "old3")).resolves.toEqual({
      data: [3],
      lastUpdatedAt: 50,
    });
  });

  it("skips malformed records and rejects a cap below one", async () => {
    mockMemory.set(
      KEY,
      JSON.stringify({ data: [{ key: "x" }, null, { key: "y", data: 1, lastSynced: 5 }], lastSynced: 5 }),
    );
    await expect(readBoundedCacheEntry(KEY, "x")).resolves.toBeNull();
    await expect(readBoundedCacheEntry(KEY, "y")).resolves.toEqual({ data: 1, lastUpdatedAt: 5 });
    await expect(writeBoundedCacheEntry(KEY, "z", 1, 0)).rejects.toThrow("maxEntries");
  });

  it("clearBrowseCaches removes every browse cache and nothing downloaded", async () => {
    for (const key of BROWSE_CACHE_KEYS) mockMemory.set(key, "{}");
    mockMemory.set(OFFLINE_CACHE_KEYS.records, "{}");
    await clearBrowseCaches();
    expect([...mockMemory.keys()]).toEqual([OFFLINE_CACHE_KEYS.records]);
    expect(BROWSE_CACHE_KEYS).toEqual(
      expect.arrayContaining([
        OFFLINE_CACHE_KEYS.recordsBrowse,
        OFFLINE_CACHE_KEYS.nationalRankings,
        OFFLINE_CACHE_KEYS.clubAthletes,
        OFFLINE_CACHE_KEYS.clubMeets,
        OFFLINE_CACHE_KEYS.clubMeetStats,
        OFFLINE_CACHE_KEYS.wsoRecordsFiltered,
      ]),
    );
  });

  it("overlapping writes to one cache keep both entries", async () => {
    // Switching class A -> class B while A's request is still running: both
    // persist into the same blob, and the second must read the first's entry.
    await Promise.all([
      writeBoundedCacheEntry(KEY, "a", "A", 5),
      writeBoundedCacheEntry(KEY, "b", "B", 5),
    ]);

    await expect(readBoundedCacheEntry(KEY, "a")).resolves.toMatchObject({ data: "A" });
    await expect(readBoundedCacheEntry(KEY, "b")).resolves.toMatchObject({ data: "B" });
  });

  it("a write in progress when a clear starts does not write the cleared entries back", async () => {
    const cacheKey = OFFLINE_CACHE_KEYS.nationalRankings;
    await writeBoundedCacheEntry(cacheKey, "old", "browsed before the clear", 5);

    let openGate = () => {};
    mockReadGate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const write = writeBoundedCacheEntry(cacheKey, "new", "in flight", 5);
    const clear = clearBrowseCaches();
    // Let the clear run as far as it can before the write's read returns.
    await new Promise((resolve) => setImmediate(resolve));
    openGate();
    await Promise.all([write, clear]);
    mockReadGate = null;

    expect(mockMemory.has(cacheKey)).toBe(false);
    await expect(readBoundedCacheEntry(cacheKey, "old")).resolves.toBeNull();
  });
});
