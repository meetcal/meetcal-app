import {
  getOfflineCache,
  OFFLINE_CACHE_KEYS,
  setOfflineCache,
} from "@/lib/database/offline-cache";
import { nationalRankingsResource } from "@/lib/database/fetch-national-rankings";
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

jest.mock("@/lib/database/offline-cache", () => ({
  OFFLINE_CACHE_KEYS: {
    nationalRankings: "@offline_cache/national_rankings",
  },
  getOfflineCache: jest.fn(),
  setOfflineCache: jest.fn(),
}));

const mockGetOfflineCache = getOfflineCache as jest.MockedFunction<
  typeof getOfflineCache
>;
const mockSetOfflineCache = setOfflineCache as jest.MockedFunction<
  typeof setOfflineCache
>;

// `nationalRankingsResource` is the only path the screen uses. The removed
// `fetchNationalRankings` wrapper re-implemented its network-then-cache policy
// with no caller outside this file.
describe("nationalRankingsResource", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns deduped online rankings and merges them into the offline cache", async () => {
    mockGetJson.mockResolvedValue([
      { name: "Athlete A", total: 250 },
      { name: "Athlete A", total: 240 },
      { name: "Athlete B", total: 235 },
      { name: null, total: 230 },
    ]);
    mockGetOfflineCache.mockResolvedValue({
      data: { "Open Women's 71kg": [] },
      lastSynced: 1,
    } as any);
    mockSetOfflineCache.mockResolvedValue({ data: {}, lastSynced: 2 } as any);

    const result = await nationalRankingsResource.revalidate("Open Men's 89kg");

    expect(result.data.map((row) => row.name)).toEqual(["Athlete A", "Athlete B"]);
    expect(result.data[0].total).toBe(250);
    expect(result.lastUpdatedAt).toBe(2);
    expect(mockSetOfflineCache).toHaveBeenCalledWith(
      OFFLINE_CACHE_KEYS.nationalRankings,
      { "Open Women's 71kg": [], "Open Men's 89kg": result.data },
    );
  });

  it("serves the cached rankings for one class and rejects a failed refresh", async () => {
    mockGetJson.mockRejectedValue(new Error("network failed"));
    mockGetOfflineCache.mockResolvedValue({
      data: {
        "Open Women's 71kg": [{ id: 0, name: "Cached Athlete", total: 220 }],
      },
      lastSynced: 1,
    } as any);

    await expect(nationalRankingsResource.loadCached("Open Women's 71kg")).resolves.toEqual({
      data: [{ id: 0, name: "Cached Athlete", total: 220 }],
      lastUpdatedAt: 1,
    });
    await expect(nationalRankingsResource.loadCached("Open Men's 102kg")).resolves.toBeNull();
    await expect(nationalRankingsResource.revalidate("Open Women's 71kg")).rejects.toThrow();
    expect(mockSetOfflineCache).not.toHaveBeenCalled();
  });
});
