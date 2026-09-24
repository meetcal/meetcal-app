const mockGetJsonArray = jest.fn();
const mockGetOfflineCache = jest.fn();
const mockSetOfflineCache = jest.fn();

jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(async () => true),
}));
jest.mock("@/lib/database/offline-cache", () => ({
  OFFLINE_CACHE_KEYS: { qualifyingTotals: "@offline_cache/qualifying_totals" },
  getOfflineCache: (...args: unknown[]) => mockGetOfflineCache(...args),
  setOfflineCache: (...args: unknown[]) => mockSetOfflineCache(...args),
}));

import { jsonFetchStub } from "@/lib/api/json-fetch-stub";

// The real API client runs, so its boundary validators see these payloads.
const originalFetch = global.fetch;
beforeAll(() => {
  global.fetch = jsonFetchStub((path, query) => mockGetJsonArray(path, query)) as unknown as typeof fetch;
});
afterAll(() => {
  global.fetch = originalFetch;
});

import { qualifyingTotalsResource } from "@/lib/database/fetch-qualifying-totals";

const fetchQualifyingTotals = async () => (await qualifyingTotalsResource.revalidate()).data;

const row = (overrides: Record<string, unknown>) => ({
  event_name: "Nationals",
  age_category: "Senior",
  gender: "Men",
  weight_class: "89kg",
  qualifying_total: 300,
  ...overrides,
});

describe("qualifyingTotalsResource", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetOfflineCache.mockImplementation(async (_key: string, data: unknown) => ({
      data,
      lastSynced: 1,
    }));
    mockGetOfflineCache.mockResolvedValue(null);
  });

  it("drops malformed rows instead of failing the whole payload", async () => {
    mockGetJsonArray.mockResolvedValue([
      row({}),
      row({ gender: "Women", weight_class: "71kg", qualifying_total: 210 }),
      row({ gender: "M" }),
      row({ gender: null }),
      row({ qualifying_total: "300" }),
      row({ event_name: null }),
      row({ age_category: 12 }),
      row({ weight_class: undefined }),
      null,
      "row",
    ]);

    const totals = await fetchQualifyingTotals();

    expect(totals).toEqual({
      Nationals: {
        Senior: { Men: { "89kg": 300 }, Women: { "71kg": 210 } },
      },
    });
    expect(mockSetOfflineCache).toHaveBeenCalledWith(
      "@offline_cache/qualifying_totals",
      totals,
    );
  });

  it("rejects when the API fails, leaving the cached copy to the screen", async () => {
    mockGetJsonArray.mockRejectedValue(new Error("down"));
    await expect(fetchQualifyingTotals()).rejects.toThrow("down");
    expect(mockSetOfflineCache).not.toHaveBeenCalled();
  });
});
