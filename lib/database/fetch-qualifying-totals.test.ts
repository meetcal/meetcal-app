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

import { fetchQualifyingTotals } from "@/lib/database/fetch-qualifying-totals";

const row = (overrides: Record<string, unknown>) => ({
  event_name: "Nationals",
  age_category: "Senior",
  gender: "Men",
  weight_class: "89kg",
  qualifying_total: 300,
  ...overrides,
});

describe("fetchQualifyingTotals", () => {
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

  it("filters by event, age, gender and weight class", async () => {
    mockGetJsonArray.mockResolvedValue([
      row({}),
      row({ weight_class: "96kg", qualifying_total: 320 }),
      row({ gender: "Women", weight_class: "71kg", qualifying_total: 210 }),
      row({ event_name: "AO", qualifying_total: 250 }),
    ]);

    await expect(
      fetchQualifyingTotals("Nationals", "Senior", "Men", "96kg"),
    ).resolves.toEqual({
      Nationals: { Senior: { Men: { "96kg": 320 }, Women: {} } },
    });
    await expect(fetchQualifyingTotals("Missing")).resolves.toEqual({});
  });

  it("serves the cached copy when the API fails and rethrows when there is none", async () => {
    mockGetJsonArray.mockRejectedValue(new Error("down"));
    mockGetOfflineCache.mockResolvedValueOnce({
      data: { Nationals: { Senior: { Men: { "89kg": 300 }, Women: {} } } },
      lastSynced: 1,
    });
    await expect(fetchQualifyingTotals("Nationals")).resolves.toEqual({
      Nationals: { Senior: { Men: { "89kg": 300 }, Women: {} } },
    });

    mockGetOfflineCache.mockResolvedValueOnce(null);
    await expect(fetchQualifyingTotals()).rejects.toThrow("down");
  });
});
