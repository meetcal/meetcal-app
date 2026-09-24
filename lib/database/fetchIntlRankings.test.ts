const mockGetJsonArray = jest.fn();
const mockGetOfflineCache = jest.fn();
const mockSetOfflineCache = jest.fn();

jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(async () => true),
}));
jest.mock("@/lib/database/offline-cache", () => ({
  OFFLINE_CACHE_KEYS: { intlRankings: "@offline_cache/intl_rankings" },
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

import { fetchIntlRankings } from "@/lib/database/fetchIntlRankings";

const row = (overrides: Record<string, unknown>) => ({
  meet: "Worlds",
  ranking: 1,
  name: "Athlete A",
  weight_class: "89kg",
  total: 380,
  percent_a: 101.5,
  gender: "Men",
  age_category: "Senior",
  ...overrides,
});

describe("fetchIntlRankings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetOfflineCache.mockImplementation(async (_key: string, data: unknown) => ({
      data,
      lastSynced: 1,
    }));
    mockGetOfflineCache.mockResolvedValue(null);
  });

  it("maps complete rows and drops incomplete ones", async () => {
    mockGetJsonArray.mockResolvedValue([
      row({}),
      row({ name: null }),
      row({ meet: "" }),
      row({ ranking: null }),
      row({ total: null }),
      row({ percent_a: null }),
      row({ gender: null }),
      row({ age_category: null }),
      row({ weight_class: null }),
      // Outside the categories `IntlRanking` declares.
      row({ gender: "Mixed" }),
      row({ age_category: "Masters" }),
      // A wrong-typed column reads as missing at the API boundary.
      row({ total: "380" }),
      null,
    ]);

    await expect(fetchIntlRankings()).resolves.toEqual([
      {
        meet: "Worlds",
        ranking: 1,
        name: "Athlete A",
        weightClass: "89kg",
        total: 380,
        percentA: 101.5,
        gender: "Men",
        ageCategory: "Senior",
      },
    ]);
    expect(mockSetOfflineCache).toHaveBeenCalledTimes(1);
  });

  it("serves the cached rankings when the API fails and rethrows otherwise", async () => {
    mockGetJsonArray.mockRejectedValue(new Error("down"));
    const cached = [{ meet: "Worlds", ranking: 2, name: "Cached" }];
    mockGetOfflineCache.mockResolvedValueOnce({ data: cached, lastSynced: 1 });
    await expect(fetchIntlRankings()).resolves.toEqual(cached);

    mockGetOfflineCache.mockResolvedValueOnce(null);
    await expect(fetchIntlRankings()).rejects.toThrow("down");
  });
});
