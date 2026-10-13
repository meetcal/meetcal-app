import { jsonTransportStub } from "@/lib/api/json-transport-stub";
import { setApiTransportForTests } from "@/lib/api/transport";
import { adaptiveRecordsFor, adaptiveRecordsResource } from "@/lib/database/fetch-adaptive-records";

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
beforeAll(() => {
  setApiTransportForTests(jsonTransportStub((path, query) => mockGetJsonArray(path, query)));
});
afterAll(() => {
  setApiTransportForTests(null);
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
      { weightClass: "67kg", snatchRecord: null, cjRecord: null, totalRecord: null },
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

  it("shows an empty fresh answer but leaves the stored download untouched", async () => {
    // The browse path shares the download's key; an empty table used to be
    // persisted over a real download, which then read as "downloaded" offline.
    mockGetOfflineCache.mockResolvedValue({ data: { Adaptive: { Men: [{ weightClass: "67kg", snatchRecord: 1, cjRecord: 2, totalRecord: 3 }], Women: [] } }, lastSynced: 5 });
    mockGetJsonArray.mockResolvedValue([]);

    await expect(fetchAdaptiveRecords()).resolves.toEqual({ Adaptive: { Men: [], Women: [] } });
    expect(mockSetOfflineCache).not.toHaveBeenCalled();
  });
});

describe("adaptiveRecordsFor", () => {
  const record = (weightClass: string) => ({ weightClass, snatchRecord: 1, cjRecord: 1, totalRecord: 2 });

  it("lists every class the season's answer holds, the Aug 1, 2026 classes included", () => {
    const men = ["60kg", "85kg", "95kg"].map(record);
    const women = ["61kg", "69kg", "77kg", "86kg", "86+kg"].map(record);
    const data = { Adaptive: { Men: men, Women: women } };
    expect(adaptiveRecordsFor(data, "Men").map((r) => r.weightClass)).toEqual(["60kg", "85kg", "95kg"]);
    expect(adaptiveRecordsFor(data, "Women").map((r) => r.weightClass)).toEqual(["61kg", "69kg", "77kg", "86kg", "86+kg"]);
  });

  it("is empty before the first load", () => {
    expect(adaptiveRecordsFor({} as never, "Men")).toEqual([]);
  });
});
