const mockGetJsonArray = jest.fn();
const mockGetOfflineCache = jest.fn();
const mockSetOfflineCache = jest.fn();

jest.mock("@/lib/api/meetcal-api", () => ({
  getJsonArray: (...args: unknown[]) => mockGetJsonArray(...args),
}));
jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(async () => true),
}));
jest.mock("@/lib/database/offline-cache", () => ({
  OFFLINE_CACHE_KEYS: { standards: "@offline_cache/standards" },
  getOfflineCache: (...args: unknown[]) => mockGetOfflineCache(...args),
  setOfflineCache: (...args: unknown[]) => mockSetOfflineCache(...args),
}));

import { fetchStandards } from "@/lib/database/fetch-standards";

const row = (overrides: Record<string, unknown>) => ({
  age_category: "Senior",
  gender: "Men",
  weight_class: "89kg",
  standard_a: 300,
  standard_b: 280,
  ...overrides,
});

describe("fetchStandards", () => {
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
      row({ weight_class: "67kg", standard_a: null, standard_b: null }),
      row({ age_category: null }),
      row({ gender: null }),
      row({ weight_class: null }),
      row({ age_category: "Masters" }),
      null,
    ]);

    const standards = await fetchStandards();

    expect(standards.senior.men).toEqual([
      { weightClass: "67kg", a: 0, b: 0 },
      { weightClass: "89kg", a: 300, b: 280 },
    ]);
    expect(standards.senior.women).toEqual([]);
    expect(Object.keys(standards).sort()).toEqual(["junior", "senior", "u15", "youth"]);
    expect(mockSetOfflineCache).toHaveBeenCalledWith("@offline_cache/standards", standards);
  });

  it("filters by age group and gender without persisting the subset", async () => {
    mockGetJsonArray.mockResolvedValue([
      row({}),
      row({ gender: "Women", weight_class: "71kg" }),
      row({ age_category: "Junior", weight_class: "73kg" }),
    ]);

    const standards = await fetchStandards("senior", "women");

    expect(standards.senior.women).toEqual([{ weightClass: "71kg", a: 300, b: 280 }]);
    expect(standards.senior.men).toEqual([]);
    expect(standards.junior.men).toEqual([]);
    expect(mockSetOfflineCache).not.toHaveBeenCalled();
  });

  it("serves the cached copy, filtered, when the API fails", async () => {
    mockGetJsonArray.mockRejectedValue(new Error("down"));
    mockGetOfflineCache.mockResolvedValue({
      data: {
        u15: { men: [], women: [] },
        youth: { men: [], women: [] },
        junior: { men: [{ weightClass: "73kg", a: 1, b: 2 }], women: [] },
        senior: { men: [{ weightClass: "89kg", a: 3, b: 4 }], women: [] },
      },
      lastSynced: 1,
    });

    const standards = await fetchStandards("senior");

    expect(standards.senior.men).toEqual([{ weightClass: "89kg", a: 3, b: 4 }]);
    expect(standards.junior.men).toEqual([]);
  });

  it("rethrows when the API fails and nothing is cached", async () => {
    mockGetJsonArray.mockRejectedValue(new Error("down"));
    await expect(fetchStandards()).rejects.toThrow("down");
  });
});
