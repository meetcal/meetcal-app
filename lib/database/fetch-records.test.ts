const mockGetJsonArray = jest.fn();
const mockGetOfflineCache = jest.fn();
const mockSetOfflineCache = jest.fn();

jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(async () => true),
}));
jest.mock("@/lib/database/offline-cache", () => ({
  OFFLINE_CACHE_KEYS: { records: "@offline_cache/records" },
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

import {
  federationRecordsResource,
  fetchAgeGroups,
} from "@/lib/database/fetch-records";
import type { RecordsData } from "@/types/records";

const fetchRecords = async (federation: string): Promise<RecordsData> =>
  (await federationRecordsResource.revalidate(federation)).data;

const row = (overrides: Record<string, unknown>) => ({
  age_category: "Senior",
  gender: "Men",
  weight_class: "89kg",
  snatch_record: 170,
  cj_record: 210,
  total_record: 380,
  record_type: "USAW",
  ...overrides,
});

describe("federationRecordsResource and fetchAgeGroups", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockSetOfflineCache.mockImplementation(async (_key: string, data: unknown) => ({
      data,
      lastSynced: 1,
    }));
    mockGetOfflineCache.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("drops incomplete rows, keeps the requested federation, and sorts weight classes", async () => {
    mockGetJsonArray.mockResolvedValue([
      row({}),
      row({ weight_class: "67kg", snatch_record: 140, cj_record: 170, total_record: 300 }),
      row({ gender: "women", weight_class: "71kg" }),
      row({ record_type: "IWF" }),
      row({ age_category: null }),
      row({ snatch_record: null }),
      row({ record_type: null }),
      row({ weight_class: "" }),
    ]);

    const records = await fetchRecords("USAW");

    expect(records.Senior.Men.map((record) => record.weightClass)).toEqual(["67kg", "89kg"]);
    expect(records.Senior.Women).toEqual([
      { weightClass: "71kg", snatchRecord: 170, cjRecord: 210, totalRecord: 380 },
    ]);
    expect(mockSetOfflineCache).toHaveBeenCalledWith("@offline_cache/records", { USAW: records });
  });

  it("orders age groups youth-first, then masters by age", async () => {
    mockGetJsonArray.mockResolvedValue([
      row({ age_category: "Masters 45-49" }),
      row({ age_category: "Senior" }),
      row({ age_category: "Masters 35-39" }),
      row({ age_category: "U15" }),
      row({ age_category: "Zed" }),
    ]);
    await expect(fetchAgeGroups("USAW")).resolves.toEqual([
      "U15",
      "Senior",
      "Zed",
      "Masters 35-39",
      "Masters 45-49",
    ]);
    await expect(fetchAgeGroups("")).resolves.toEqual([]);
  });

  it("falls back to the cached federation for age groups and rejects the records fetch", async () => {
    mockGetJsonArray.mockRejectedValue(new Error("down"));
    mockGetOfflineCache.mockResolvedValue({
      data: {
        USAW: {
          Senior: { Men: [{ weightClass: "89kg", snatchRecord: 1, cjRecord: 2, totalRecord: 3 }], Women: [] },
          Junior: { Men: [], Women: [] },
        },
      },
      lastSynced: 1,
    });

    // Age groups fall back to the cached federation; the records fetch
    // rejects, leaving the cached copy to the screen.
    await expect(fetchAgeGroups("USAW")).resolves.toEqual(["Junior", "Senior"]);
    await expect(fetchRecords("USAW")).rejects.toThrow("down");
    expect(mockSetOfflineCache).not.toHaveBeenCalled();

    mockGetOfflineCache.mockResolvedValue(null);
    await expect(fetchAgeGroups("USAW")).rejects.toThrow("down");
  });
});
