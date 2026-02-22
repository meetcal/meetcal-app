import {
  getOfflineCache,
  OFFLINE_CACHE_KEYS,
  setOfflineCache,
} from "@/lib/database/offline-cache";
import { fetchNationalRankings } from "@/lib/database/fetch-national-rankings";

const mockQuery = jest.fn();

jest.mock("@/lib/convex", () => ({
  convex: {
    query: (...args: any[]) => mockQuery(...args),
  },
}));

jest.mock("@/convex/_generated/api", () => ({
  api: {
    liftingResults: {
      getNationalRankings: "liftingResults:getNationalRankings",
    },
  },
}));

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

describe("fetchNationalRankings offline cache behavior", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns deduped online rankings and updates offline cache", async () => {
    mockQuery.mockResolvedValue([
      { name: "Athlete A", total: 250 },
      { name: "Athlete A", total: 240 },
      { name: "Athlete B", total: 235 },
    ]);
    mockGetOfflineCache.mockResolvedValue({ data: {}, lastSynced: 1 } as any);
    mockSetOfflineCache.mockResolvedValue({ data: {}, lastSynced: 2 } as any);

    const result = await fetchNationalRankings("Open Men's 89kg");

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Athlete A");
    expect(result[1].name).toBe("Athlete B");
    expect(mockSetOfflineCache).toHaveBeenCalledWith(
      OFFLINE_CACHE_KEYS.nationalRankings,
      { "Open Men's 89kg": result },
    );
  });

  it("falls back to cached rankings when convex fails", async () => {
    mockQuery.mockRejectedValue(new Error("network failed"));
    mockGetOfflineCache.mockResolvedValue({
      data: {
        "Open Women's 71kg": [{ name: "Cached Athlete", total: 220 }],
      },
      lastSynced: 1,
    } as any);

    const result = await fetchNationalRankings("Open Women's 71kg");

    expect(result).toEqual([{ name: "Cached Athlete", total: 220 }]);
  });

  it("throws when convex fails and no cached rankings exist", async () => {
    mockQuery.mockRejectedValue(new Error("network failed"));
    mockGetOfflineCache.mockResolvedValue(null);

    await expect(fetchNationalRankings("Open Men's 102kg")).rejects.toThrow();
  });
});
