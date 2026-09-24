const mockGetJsonArray = jest.fn();
const mockFetchApiWsoList = jest.fn();
const mockFetchApiWsoAgeGroups = jest.fn();
const mockGetOfflineCache = jest.fn();
const mockSetOfflineCache = jest.fn();

jest.mock("@/lib/api/meetcal-api", () => ({
  getJsonArray: (...args: unknown[]) => mockGetJsonArray(...args),
  fetchApiWsoList: (...args: unknown[]) => mockFetchApiWsoList(...args),
  fetchApiWsoAgeGroups: (...args: unknown[]) => mockFetchApiWsoAgeGroups(...args),
}));
jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(async () => true),
}));
jest.mock("@/lib/database/offline-cache", () => ({
  OFFLINE_CACHE_KEYS: {
    wsoRecords: "@offline_cache/wso_records",
    wsoRecordsFiltered: "@offline_cache/wso_records_filtered",
  },
  getOfflineCache: (...args: unknown[]) => mockGetOfflineCache(...args),
  setOfflineCache: (...args: unknown[]) => mockSetOfflineCache(...args),
}));

import { fetchWSOList, fetchWSORecords } from "@/lib/database/fetch-wso-records";

const row = (overrides: Record<string, unknown>) => ({
  age_category: "Senior",
  gender: "Men",
  weight_class: "89kg",
  snatch_record: 150,
  cj_record: 180,
  total_record: 330,
  wso: "Carolina",
  ...overrides,
});

describe("fetchWSORecords", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetOfflineCache.mockImplementation(async (_key: string, data: unknown) => ({
      data,
      lastSynced: 1,
    }));
    mockGetOfflineCache.mockResolvedValue(null);
  });

  it("drops rows without an age category or weight class and skips unknown genders", async () => {
    mockGetJsonArray.mockResolvedValue([
      row({}),
      row({ weight_class: "67kg", snatch_record: null, cj_record: null, total_record: null }),
      row({ age_category: null }),
      row({ weight_class: null }),
      row({ gender: "Mixed" }),
      row({ gender: null }),
      null,
    ]);

    const records = await fetchWSORecords("Carolina");

    // A null age category used to become a literal "null" bucket the user
    // could select.
    expect(Object.keys(records)).toEqual(["Senior"]);
    expect(records.Senior.Men.map((record) => record.weightClass)).toEqual(["67kg", "89kg"]);
    expect(records.Senior.Men[0]).toEqual({
      weightClass: "67kg",
      snatchRecord: 0,
      cjRecord: 0,
      totalRecord: 0,
    });
    expect(records.Senior.Women).toEqual([]);
    expect(mockGetJsonArray).toHaveBeenCalledWith("/data/wso/records", {
      wso: "Carolina",
      age_category: undefined,
      gender: undefined,
    });
  });

  it("serves the cached WSO when the API fails and rethrows when there is none", async () => {
    mockGetJsonArray.mockRejectedValue(new Error("down"));
    const carolina = {
      Senior: { Men: [{ weightClass: "89kg", snatchRecord: 1, cjRecord: 2, totalRecord: 3 }], Women: [] },
      Junior: { Men: [], Women: [] },
    };
    mockGetOfflineCache.mockImplementation(async (key: string) =>
      key === "@offline_cache/wso_records"
        ? { data: { Carolina: carolina }, lastSynced: 1 }
        : null,
    );

    await expect(fetchWSORecords("Carolina")).resolves.toEqual(carolina);
    await expect(fetchWSORecords("Ohio")).rejects.toThrow("down");

    mockGetOfflineCache.mockResolvedValue(null);
    await expect(fetchWSORecords("Carolina")).rejects.toThrow("down");
  });

  it("lists WSOs from the API and falls back to the cached records' keys", async () => {
    mockFetchApiWsoList.mockResolvedValueOnce(["Carolina", "Ohio"]);
    await expect(fetchWSOList()).resolves.toEqual(["Carolina", "Ohio"]);

    mockFetchApiWsoList.mockRejectedValue(new Error("down"));
    mockGetOfflineCache.mockResolvedValueOnce({
      data: { Ohio: {}, carolina: {} },
      lastSynced: 1,
    });
    await expect(fetchWSOList()).resolves.toEqual(["carolina", "Ohio"]);

    mockGetOfflineCache.mockResolvedValueOnce(null);
    await expect(fetchWSOList()).rejects.toThrow("down");
  });
});
