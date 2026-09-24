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
  OFFLINE_CACHE_KEYS: { adaptiveRecords: "@offline_cache/adaptive_records" },
  getOfflineCache: (...args: unknown[]) => mockGetOfflineCache(...args),
  setOfflineCache: (...args: unknown[]) => mockSetOfflineCache(...args),
}));

import { fetchAdaptiveRecords } from "@/lib/database/fetch-adaptive-records";

describe("fetchAdaptiveRecords", () => {
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

  it("fetches one gender under a custom age group without persisting", async () => {
    mockGetJsonArray.mockResolvedValue([{ weight_class: "71kg", snatch: 80, cj: 100, total: 180 }]);

    const records = await fetchAdaptiveRecords("Women", "Custom");

    expect(records).toEqual({
      Custom: {
        Men: [],
        Women: [{ weightClass: "71kg", snatchRecord: 80, cjRecord: 100, totalRecord: 180 }],
      },
    });
    expect(mockGetJsonArray).toHaveBeenCalledTimes(1);
    expect(mockSetOfflineCache).not.toHaveBeenCalled();
  });

  it("serves the cached copy, remapped to the requested age group, when the API fails", async () => {
    mockGetJsonArray.mockRejectedValue(new Error("down"));
    mockGetOfflineCache.mockResolvedValue({
      data: { Adaptive: { Men: [{ weightClass: "89kg", snatchRecord: 1, cjRecord: 2, totalRecord: 3 }], Women: [] } },
      lastSynced: 1,
    });

    const records = await fetchAdaptiveRecords(undefined, "Other");
    expect(records).toEqual({
      Other: { Men: [{ weightClass: "89kg", snatchRecord: 1, cjRecord: 2, totalRecord: 3 }], Women: [] },
    });

    mockGetOfflineCache.mockResolvedValue(null);
    await expect(fetchAdaptiveRecords()).rejects.toThrow("down");
  });
});
