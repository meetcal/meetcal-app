const mockGetJsonArray = jest.fn();
const mockGetOfflineCache = jest.fn();
const mockSetOfflineCache = jest.fn();

jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(async () => true),
}));
jest.mock("@/lib/database/offline-cache", () => ({
  OFFLINE_CACHE_KEYS: { standards: "@offline_cache/standards" },
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

import { standardsResource } from "@/lib/database/fetch-standards";

const fetchStandards = async () => (await standardsResource.revalidate()).data;

const row = (overrides: Record<string, unknown>) => ({
  age_category: "Senior",
  gender: "Men",
  weight_class: "89kg",
  standard_a: 300,
  standard_b: 280,
  ...overrides,
});

describe("standardsResource", () => {
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

  it("rejects when the API fails, leaving the cached copy to the screen", async () => {
    mockGetJsonArray.mockRejectedValue(new Error("down"));
    await expect(fetchStandards()).rejects.toThrow("down");
    expect(mockSetOfflineCache).not.toHaveBeenCalled();
  });
});
