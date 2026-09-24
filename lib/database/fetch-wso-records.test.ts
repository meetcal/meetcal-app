import AsyncStorage from "@react-native-async-storage/async-storage";
const mockGetJsonArray = jest.fn();
const mockFetchApiWsoList = jest.fn();
const mockFetchApiWsoAgeGroups = jest.fn();

jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(async () => true),
}));

import { jsonFetchStub } from "@/lib/api/json-fetch-stub";

// The real API client runs, so its boundary validators see these payloads.
const originalFetch = global.fetch;
beforeAll(() => {
  global.fetch = jsonFetchStub((path, query) => {
    if (path === "/data/wso/") return mockFetchApiWsoList();
    if (path === "/data/wso/age-groups") return mockFetchApiWsoAgeGroups(query.wso);
    return mockGetJsonArray(path, query);
  }) as unknown as typeof fetch;
});
afterAll(() => {
  global.fetch = originalFetch;
});

import {
  downloadWSORecordsForOffline,
  fetchWSOAgeGroups,
  MAX_CACHED_WSO_RECORD_VIEWS,
  wsoListResource,
  wsoRecordsResource,
} from "@/lib/database/fetch-wso-records";
import { getOfflineCache, OFFLINE_CACHE_KEYS } from "@/lib/database/offline-cache";
import type { RecordsData } from "@/types/records";

const WSO_KEY = OFFLINE_CACHE_KEYS.wsoRecords;
const FILTERED_KEY = OFFLINE_CACHE_KEYS.wsoRecordsFiltered;

/** Writes a raw offline-cache entry, as an earlier app version may have. */
async function seed(key: string, data: unknown, lastSynced: number) {
  await AsyncStorage.setItem(key, JSON.stringify({ data, lastSynced }));
}

// The real offline cache runs over the AsyncStorage mock from jest.setup.js.
beforeEach(async () => {
  await AsyncStorage.clear();
});

/** One WSO's records, unfiltered, as the offline download stores them. */
async function fetchWSORecords(wso: string): Promise<RecordsData> {
  mockFetchApiWsoList.mockResolvedValueOnce([wso]);
  await downloadWSORecordsForOffline();
  const stored = await getOfflineCache<Record<string, RecordsData>>(WSO_KEY);
  return stored!.data[wso];
}

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

describe("WSO records mapping and list", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    expect(mockGetJsonArray).toHaveBeenCalledWith("/data/wso/records", { wso: "Carolina" });
  });

  it("lists WSOs from the API, and from the cached records' keys, sorted", async () => {
    mockFetchApiWsoList.mockResolvedValueOnce(["Carolina", "Ohio"]);
    await expect(wsoListResource.revalidate()).resolves.toMatchObject({
      data: ["Carolina", "Ohio"],
    });

    await expect(wsoListResource.loadCached()).resolves.toBeNull();

    await seed(WSO_KEY, { Ohio: {}, carolina: {} }, 1);
    await expect(wsoListResource.loadCached()).resolves.toEqual({
      data: ["carolina", "Ohio"],
      lastUpdatedAt: 1,
    });
  });
});

describe("wsoRecordsResource offline cache", () => {
  const senior = { Men: [{ weightClass: "89kg", snatchRecord: 1, cjRecord: 2, totalRecord: 3 }], Women: [{ weightClass: "71kg", snatchRecord: 4, cjRecord: 5, totalRecord: 9 }] };
  const junior = { Men: [], Women: [{ weightClass: "64kg", snatchRecord: 6, cjRecord: 7, totalRecord: 13 }] };
  const full = { Carolina: { Senior: senior, Junior: junior } };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Date, "now").mockReturnValue(20);
    await seed(WSO_KEY, full, 10);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("derives a filtered view from the full WSO cache when no filtered copy exists", async () => {
    await expect(wsoRecordsResource.loadCached("Carolina", "Senior", "Men")).resolves.toEqual({
      data: { Senior: { Men: senior.Men, Women: [] } },
      lastUpdatedAt: 10,
    });
    await expect(wsoRecordsResource.loadCached("Ohio", "Senior", "Men")).resolves.toBeNull();
  });

  it("prefers the exact filtered copy over the derived view", async () => {
    const filtered = { Senior: { Men: [{ weightClass: "96kg", snatchRecord: 9, cjRecord: 9, totalRecord: 18 }], Women: [] } };
    // The shape the filtered cache held before it was bounded.
    await seed(FILTERED_KEY, { "Carolina:Senior:Men": filtered }, 15);
    await expect(wsoRecordsResource.loadCached("Carolina", "Senior", "Men")).resolves.toEqual({
      data: filtered,
      lastUpdatedAt: 15,
    });
  });

  it("stores a filtered refresh under its own key and never over the full WSO copy", async () => {
    mockGetJsonArray.mockResolvedValue([
      row({ age_category: "Senior", gender: "Men", weight_class: "102kg", total_record: 400 }),
    ]);

    await wsoRecordsResource.revalidate("Carolina", "Senior", "Men");

    // The full copy is what every other filter falls back to offline; a
    // one-age-group subset written over it would hide the rest.
    await expect(getOfflineCache(WSO_KEY)).resolves.toEqual({ data: full, lastSynced: 10 });
    const stored = { Senior: { Men: [{ weightClass: "102kg", snatchRecord: 150, cjRecord: 180, totalRecord: 400 }], Women: [] } };
    await expect(wsoRecordsResource.loadCached("Carolina", "Senior", "Men")).resolves.toEqual({
      data: stored,
      lastUpdatedAt: 20,
    });
  });

  it(`keeps the ${MAX_CACHED_WSO_RECORD_VIEWS} most recently viewed filters`, async () => {
    mockGetJsonArray.mockResolvedValue([row({ age_category: "Senior", gender: "Men" })]);
    for (let i = 0; i <= MAX_CACHED_WSO_RECORD_VIEWS; i += 1) {
      await wsoRecordsResource.revalidate(`WSO ${i}`, "Senior", "Men");
    }
    // Nothing cached for the evicted filter: not the view, and no full copy.
    await expect(wsoRecordsResource.loadCached("WSO 0", "Senior", "Men")).resolves.toBeNull();
    await expect(wsoRecordsResource.loadCached("WSO 1", "Senior", "Men")).resolves.not.toBeNull();
    // The downloaded full copy is not part of the cap.
    await expect(getOfflineCache(WSO_KEY)).resolves.toEqual({ data: full, lastSynced: 10 });
  });
});

describe("fetchWSOAgeGroups", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not call the API for an empty WSO", async () => {
    await expect(fetchWSOAgeGroups("")).resolves.toEqual([]);
    expect(mockFetchApiWsoAgeGroups).not.toHaveBeenCalled();
  });

  it("falls back to the cached WSO's age groups and rethrows with nothing cached", async () => {
    mockFetchApiWsoAgeGroups.mockRejectedValue(new Error("down"));
    await expect(fetchWSOAgeGroups("Carolina")).rejects.toThrow();

    await seed(
      WSO_KEY,
      { Carolina: { Senior: { Men: [], Women: [] }, Junior: { Men: [], Women: [] } } },
      1,
    );
    await expect(fetchWSOAgeGroups("Carolina")).resolves.toEqual(["Senior", "Junior"]);
  });

  it("rejects a non-string age-group list from the API", async () => {
    mockFetchApiWsoAgeGroups.mockResolvedValue([{ age: "Senior" }]);
    await expect(fetchWSOAgeGroups("Carolina")).rejects.toThrow();
  });
});
