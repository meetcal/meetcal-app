import { jsonTransportStub } from "@/lib/api/json-transport-stub";
import { setApiTransportForTests } from "@/lib/api/transport";
import {
  downloadRecordsForOffline,
  federationRecordsResource,
  fetchAgeGroups,
} from "@/lib/database/fetch-records";
import { getOfflineCache, OFFLINE_CACHE_KEYS } from "@/lib/database/offline-cache";
import type { RecordsData } from "@/types/records";

const mockGetJsonArray = jest.fn();
const mockMemory = new Map<string, string>();

jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(async () => true),
}));
// The real offline cache runs over an in-memory AsyncStorage, so the test
// sees which entry each path writes and with what `lastSynced`.
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockMemory.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockMemory.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockMemory.delete(key);
    }),
  },
}));

// The real API client runs, so its boundary validators see these payloads.
beforeAll(() => {
  setApiTransportForTests(jsonTransportStub((path, query) => mockGetJsonArray(path, query)));
});
afterAll(() => {
  setApiTransportForTests(null);
});

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

const seniorMen = (snatchRecord: number): RecordsData => ({
  Senior: {
    Men: [{ weightClass: "89kg", snatchRecord, cjRecord: 2, totalRecord: 3 }],
    Women: [],
  },
});

describe("federationRecordsResource and fetchAgeGroups", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMemory.clear();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("drops rows without their keys, keeps the requested federation, and sorts weight classes", async () => {
    mockGetJsonArray.mockResolvedValue([
      row({}),
      row({ weight_class: "67kg", snatch_record: 140, cj_record: 170, total_record: 300 }),
      row({ gender: "women", weight_class: "71kg" }),
      row({ record_type: "IWF" }),
      row({ age_category: null }),
      row({ record_type: null }),
      row({ weight_class: "" }),
    ]);

    const records = await fetchRecords("USAW");

    expect(records.Senior.Men.map((record) => record.weightClass)).toEqual(["67kg", "89kg"]);
    expect(records.Senior.Women).toEqual([
      { weightClass: "71kg", snatchRecord: 170, cjRecord: 210, totalRecord: 380 },
    ]);
    await expect(federationRecordsResource.loadCached("USAW")).resolves.toEqual({
      data: records,
      lastUpdatedAt: expect.any(Number),
    });
  });

  // A class with one unset lift used to vanish, its claimed lifts with it;
  // the screen shows the unset lift (null or 0) as "—".
  it("keeps a class with an unset lift, and an all-zero masters class", async () => {
    mockGetJsonArray.mockResolvedValue([
      row({ age_category: "Masters 60", weight_class: "58kg", snatch_record: 40, cj_record: null, total_record: null }),
      row({ age_category: "Masters 85", gender: "Women", weight_class: "48kg", snatch_record: 0, cj_record: 0, total_record: 0 }),
    ]);

    const records = await fetchRecords("USAW");

    expect(records["Masters 60"].Men).toEqual([
      { weightClass: "58kg", snatchRecord: 40, cjRecord: null, totalRecord: null },
    ]);
    expect(records["Masters 85"].Women).toEqual([
      { weightClass: "48kg", snatchRecord: 0, cjRecord: 0, totalRecord: 0 },
    ]);
  });

  // Browsing used to merge into the download's entry and reset its
  // `lastSynced`, so Offline Data showed the records as downloaded "just now".
  it("browsing never writes the offline download's entry", async () => {
    mockGetJsonArray.mockResolvedValue([row({})]);

    await fetchRecords("USAW");

    await expect(getOfflineCache(OFFLINE_CACHE_KEYS.records)).resolves.toBeNull();
    expect(mockMemory.has(OFFLINE_CACHE_KEYS.recordsBrowse)).toBe(true);
  });

  it("leaves a month-old download and its sync time alone when browsing", async () => {
    const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    mockMemory.set(
      OFFLINE_CACHE_KEYS.records,
      JSON.stringify({ data: { USAW: seniorMen(1), IWF: seniorMen(2) }, lastSynced: monthAgo }),
    );
    mockGetJsonArray.mockResolvedValue([row({ snatch_record: 175 })]);

    await fetchRecords("USAW");

    await expect(getOfflineCache(OFFLINE_CACHE_KEYS.records)).resolves.toEqual({
      data: { USAW: seniorMen(1), IWF: seniorMen(2) },
      lastSynced: monthAgo,
    });
    // The newer browsed copy is what USAW shows; IWF still reads the download.
    await expect(federationRecordsResource.loadCached("USAW")).resolves.toMatchObject({
      data: { Senior: { Men: [expect.objectContaining({ snatchRecord: 175 })] } },
    });
    await expect(federationRecordsResource.loadCached("IWF")).resolves.toEqual({
      data: seniorMen(2),
      lastUpdatedAt: monthAgo,
    });
  });

  it("serves a download newer than the browsed copy", async () => {
    mockGetJsonArray.mockResolvedValue([row({ snatch_record: 150 })]);
    await fetchRecords("USAW");
    mockGetJsonArray.mockResolvedValue([row({ snatch_record: 180 }), row({ record_type: "IWF" })]);
    await new Promise((resolve) => setTimeout(resolve, 2));

    await downloadRecordsForOffline();

    await expect(federationRecordsResource.loadCached("USAW")).resolves.toMatchObject({
      data: { Senior: { Men: [expect.objectContaining({ snatchRecord: 180 })] } },
    });
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
    const downloaded = JSON.stringify({
      data: {
        USAW: {
          Senior: { Men: [{ weightClass: "89kg", snatchRecord: 1, cjRecord: 2, totalRecord: 3 }], Women: [] },
          Junior: { Men: [], Women: [] },
        },
      },
      lastSynced: 1,
    });
    mockMemory.set(OFFLINE_CACHE_KEYS.records, downloaded);

    // Age groups fall back to the cached federation; the records fetch
    // rejects, leaving the cached copy to the screen.
    await expect(fetchAgeGroups("USAW")).resolves.toEqual(["Junior", "Senior"]);
    await expect(fetchRecords("USAW")).rejects.toThrow("down");
    expect(mockMemory.get(OFFLINE_CACHE_KEYS.records)).toBe(downloaded);
    expect(mockMemory.has(OFFLINE_CACHE_KEYS.recordsBrowse)).toBe(false);

    mockMemory.clear();
    await expect(fetchAgeGroups("USAW")).rejects.toThrow("down");
  });
});
