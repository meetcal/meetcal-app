import { jsonFetchStub } from "@/lib/api/json-fetch-stub";
import { adaptiveRecordsResource } from "@/lib/database/fetch-adaptive-records";

const mockGetJsonArray = jest.fn();
const mockGetOfflineCache = jest.fn();
const mockSetOfflineCache = jest.fn();

jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(async () => true),
}));
jest.mock("@/lib/database/offline-cache", () => ({
  OFFLINE_CACHE_KEYS: { adaptiveRecords: "@offline_cache/adaptive_records" },
  getOfflineCache: (...args: unknown[]) => mockGetOfflineCache(...args),
  setOfflineCache: (...args: unknown[]) => mockSetOfflineCache(...args),
}));

// The real API client runs, so its boundary validators see these payloads.
const originalFetch = global.fetch;
beforeAll(() => {
  global.fetch = jsonFetchStub((path, query) => mockGetJsonArray(path, query)) as unknown as typeof fetch;
});
afterAll(() => {
  global.fetch = originalFetch;
});

const fetchAdaptiveRecords = async () => (await adaptiveRecordsResource.revalidate()).data;

describe("adaptiveRecordsResource", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetOfflineCache.mockImplementation(async (_key: string, data: unknown) => ({
      data,
      lastSynced: 1,
    }));
    mockGetOfflineCache.mockResolvedValue(null);
  });

  it("drops rows without a weight class, normalizes the unit and nulls, and sorts", async () => {
    mockGetJsonArray.mockImplementation(async (_path: string, query: { gender: string }) =>
      query.gender === "Men"
        ? [
            { weight_class: "102", snatch: 100, cj: 120, total: 220 },
            { weight_class: "67kg", snatch: null, cj: null, total: null },
            { weight_class: null, snatch: 1, cj: 1, total: 1 },
            null,
          ]
        : [],
    );

    const records = await fetchAdaptiveRecords();

    expect(records.Adaptive.Men).toEqual([
      { weightClass: "67kg", snatchRecord: 0, cjRecord: 0, totalRecord: 0 },
      { weightClass: "102kg", snatchRecord: 100, cjRecord: 120, totalRecord: 220 },
    ]);
    expect(records.Adaptive.Women).toEqual([]);
    expect(mockSetOfflineCache).toHaveBeenCalledWith("@offline_cache/adaptive_records", records);
  });

  it("rejects when the API fails, leaving the cached copy to the screen", async () => {
    mockGetJsonArray.mockRejectedValue(new Error("down"));
    await expect(fetchAdaptiveRecords()).rejects.toThrow("down");
    expect(mockSetOfflineCache).not.toHaveBeenCalled();
  });
});
