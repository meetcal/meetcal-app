import AsyncStorage from "@react-native-async-storage/async-storage";
import { OFFLINE_CACHE_KEYS, writeBoundedCacheEntry } from "@/lib/database/offline-cache";
import {
  MAX_CACHED_RANKING_CLASSES,
  nationalRankingsResource,
} from "@/lib/database/fetch-national-rankings";
import { jsonFetchStub } from "@/lib/api/json-fetch-stub";

const mockGetJson = jest.fn();

// The real API client runs, so its boundary validators see these payloads.
const originalFetch = global.fetch;
beforeAll(() => {
  global.fetch = jsonFetchStub((path, query) => mockGetJson(path, query)) as unknown as typeof fetch;
});
afterAll(() => {
  global.fetch = originalFetch;
});

// The real offline cache runs over the AsyncStorage mock from jest.setup.js.
beforeEach(async () => {
  await AsyncStorage.clear();
});

// `nationalRankingsResource` is the only path the screen uses. The removed
// `fetchNationalRankings` wrapper re-implemented its network-then-cache policy
// with no caller outside this file.
describe("nationalRankingsResource", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, "now").mockReturnValue(2);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns deduped online rankings and adds them to the offline cache", async () => {
    await writeBoundedCacheEntry(OFFLINE_CACHE_KEYS.nationalRankings, "Open Women's 71kg", [], 5);
    mockGetJson.mockResolvedValue([
      { name: "Athlete A", total: 250 },
      { name: "Athlete A", total: 240 },
      { name: "Athlete B", total: 235 },
      { name: null, total: 230 },
    ]);

    const result = await nationalRankingsResource.revalidate("Open Men's 89kg");

    expect(result.data.map((row) => row.name)).toEqual(["Athlete A", "Athlete B"]);
    expect(result.data[0].total).toBe(250);
    expect(result.lastUpdatedAt).toBe(2);
    await expect(nationalRankingsResource.loadCached("Open Men's 89kg")).resolves.toEqual({
      data: result.data,
      lastUpdatedAt: 2,
    });
    await expect(nationalRankingsResource.loadCached("Open Women's 71kg")).resolves.toEqual({
      data: [],
      lastUpdatedAt: 2,
    });
  });

  it("serves the cached rankings for one class and rejects a failed refresh", async () => {
    // The shape the cache held before it was bounded.
    await AsyncStorage.setItem(
      OFFLINE_CACHE_KEYS.nationalRankings,
      JSON.stringify({
        data: { "Open Women's 71kg": [{ id: 0, name: "Cached Athlete", total: 220 }] },
        lastSynced: 1,
      }),
    );
    mockGetJson.mockRejectedValue(new Error("network failed"));

    await expect(nationalRankingsResource.loadCached("Open Women's 71kg")).resolves.toEqual({
      data: [{ id: 0, name: "Cached Athlete", total: 220 }],
      lastUpdatedAt: 1,
    });
    await expect(nationalRankingsResource.loadCached("Open Men's 102kg")).resolves.toBeNull();
    const before = await AsyncStorage.getItem(OFFLINE_CACHE_KEYS.nationalRankings);
    await expect(nationalRankingsResource.revalidate("Open Women's 71kg")).rejects.toThrow();
    await expect(AsyncStorage.getItem(OFFLINE_CACHE_KEYS.nationalRankings)).resolves.toBe(before);
  });

  it(`keeps only the ${MAX_CACHED_RANKING_CLASSES} most recently viewed classes`, async () => {
    mockGetJson.mockResolvedValue([{ name: "Athlete A", total: 250 }]);
    for (let i = 0; i <= MAX_CACHED_RANKING_CLASSES; i += 1) {
      await nationalRankingsResource.revalidate(`Class ${i}`);
    }
    await expect(nationalRankingsResource.loadCached("Class 0")).resolves.toBeNull();
    await expect(nationalRankingsResource.loadCached("Class 1")).resolves.not.toBeNull();
    await expect(
      nationalRankingsResource.loadCached(`Class ${MAX_CACHED_RANKING_CLASSES}`),
    ).resolves.not.toBeNull();
  });
});
