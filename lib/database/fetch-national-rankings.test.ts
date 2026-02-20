import { supabase } from "@/lib/supabase";
import {
  getOfflineCache,
  OFFLINE_CACHE_KEYS,
  setOfflineCache,
} from "@/lib/database/offline-cache";
import { fetchNationalRankings } from "@/lib/database/fetch-national-rankings";

jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock("@/lib/database/offline-cache", () => ({
  OFFLINE_CACHE_KEYS: {
    nationalRankings: "@offline_cache/national_rankings",
  },
  getOfflineCache: jest.fn(),
  setOfflineCache: jest.fn(),
}));

const mockSupabaseFrom = supabase.from as jest.Mock;
const mockGetOfflineCache = getOfflineCache as jest.MockedFunction<
  typeof getOfflineCache
>;
const mockSetOfflineCache = setOfflineCache as jest.MockedFunction<
  typeof setOfflineCache
>;

function mockRankingsQuery(result: { data: any[] | null; error: any }) {
  const chain: Record<string, any> = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    not: jest.fn(() => chain),
    order: jest.fn().mockResolvedValue(result),
  };
  mockSupabaseFrom.mockReturnValue(chain);
}

describe("fetchNationalRankings offline cache behavior", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns deduped online rankings and updates offline cache", async () => {
    mockRankingsQuery({
      data: [
        { id: 1, name: "Athlete A", total: 250 },
        { id: 2, name: "Athlete A", total: 240 },
        { id: 3, name: "Athlete B", total: 235 },
      ],
      error: null,
    });
    mockGetOfflineCache.mockResolvedValue({ data: {}, lastSynced: 1 } as any);
    mockSetOfflineCache.mockResolvedValue({ data: {}, lastSynced: 2 } as any);

    const result = await fetchNationalRankings("Open Men's 89kg");

    expect(result).toEqual([
      { id: 1, name: "Athlete A", total: 250 },
      { id: 3, name: "Athlete B", total: 235 },
    ]);
    expect(mockSetOfflineCache).toHaveBeenCalledWith(
      OFFLINE_CACHE_KEYS.nationalRankings,
      { "Open Men's 89kg": result },
    );
  });

  it("falls back to cached rankings when supabase fails", async () => {
    mockRankingsQuery({
      data: null,
      error: new Error("network failed"),
    });
    mockGetOfflineCache.mockResolvedValue({
      data: {
        "Open Women's 71kg": [{ id: 9, name: "Cached Athlete", total: 220 }],
      },
      lastSynced: 1,
    } as any);

    const result = await fetchNationalRankings("Open Women's 71kg");

    expect(result).toEqual([{ id: 9, name: "Cached Athlete", total: 220 }]);
  });

  it("throws when supabase fails and no cached rankings exist", async () => {
    mockRankingsQuery({
      data: null,
      error: new Error("network failed"),
    });
    mockGetOfflineCache.mockResolvedValue(null);

    await expect(fetchNationalRankings("Open Men's 102kg")).rejects.toThrow(
      "network failed",
    );
  });
});
