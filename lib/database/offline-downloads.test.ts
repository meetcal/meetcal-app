/**
 * The `download*ForOffline` writers behind "Download" and "Refresh All".
 *
 * Unlike the browse fetchers they must never fall back to the cached copy:
 * a refresh that could not reach the API has to *fail*, so the refresh can
 * report it, and must leave the stored copy exactly as it was.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const mockIsNetworkAvailable = jest.fn<Promise<boolean>, []>(async () => true);
jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: () => mockIsNetworkAvailable(),
}));

import { jsonFetchStub } from "@/lib/api/json-fetch-stub";
import { OFFLINE_CACHE_KEYS } from "@/lib/database/offline-cache";
import {
  downloadStandardsForOffline,
  fetchStandards,
} from "@/lib/database/fetch-standards";
import { downloadRecordsForOffline } from "@/lib/database/fetch-records";
import {
  downloadWSORecordsForOffline,
  MAX_OFFLINE_WSO_COUNT,
} from "@/lib/database/fetch-wso-records";
import { downloadIntlRankingsForOffline } from "@/lib/database/fetchIntlRankings";

const mockRespond = jest.fn<Promise<unknown>, [string, Record<string, string>]>();
const originalFetch = global.fetch;
beforeAll(() => {
  global.fetch = jsonFetchStub((path, query) => mockRespond(path, query)) as unknown as typeof fetch;
});
afterAll(() => {
  global.fetch = originalFetch;
});

const oldEntry = JSON.stringify({ data: { old: true }, lastSynced: 1 });

async function readData(key: string): Promise<unknown> {
  const raw = await AsyncStorage.getItem(key);
  return raw ? (JSON.parse(raw) as { data: unknown }).data : null;
}

const recordRow = (overrides: Record<string, unknown>) => ({
  age_category: "Senior",
  gender: "Men",
  weight_class: "89kg",
  snatch_record: 170,
  cj_record: 210,
  total_record: 380,
  record_type: "USAW",
  ...overrides,
});

beforeEach(async () => {
  jest.clearAllMocks();
  mockRespond.mockReset();
  mockIsNetworkAvailable.mockResolvedValue(true);
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("downloadStandardsForOffline", () => {
  it("rejects on an API failure and leaves the stored copy, where fetchStandards serves the cache", async () => {
    await AsyncStorage.setItem(OFFLINE_CACHE_KEYS.standards, oldEntry);
    mockRespond.mockRejectedValue(new Error("Network request failed"));

    // The browse fetcher "succeeds" from cache: fine for a screen, wrong for
    // a refresh, which would then report "Refresh Complete".
    await expect(fetchStandards()).resolves.toEqual({ old: true });
    await expect(downloadStandardsForOffline()).rejects.toThrow();
    await expect(AsyncStorage.getItem(OFFLINE_CACHE_KEYS.standards)).resolves.toBe(oldEntry);
  });

  it("rejects when offline without calling the API", async () => {
    mockIsNetworkAvailable.mockResolvedValue(false);
    await expect(downloadStandardsForOffline()).rejects.toThrow("Offline");
    expect(mockRespond).not.toHaveBeenCalled();
  });

  it("rejects when the write fails instead of reporting it stored", async () => {
    mockRespond.mockResolvedValue([]);
    jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("SQLITE_FULL"));
    await expect(downloadStandardsForOffline()).rejects.toThrow("SQLITE_FULL");
  });
});

describe("downloadRecordsForOffline", () => {
  it("stores every federation from one request, replacing the old copy", async () => {
    await AsyncStorage.setItem(OFFLINE_CACHE_KEYS.records, oldEntry);
    mockRespond.mockResolvedValue([
      recordRow({}),
      recordRow({ record_type: "IWF", weight_class: "81kg" }),
      recordRow({ record_type: null }),
    ]);

    await downloadRecordsForOffline();

    expect(mockRespond).toHaveBeenCalledTimes(1);
    const stored = (await readData(OFFLINE_CACHE_KEYS.records)) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(["IWF", "USAW"]);
    expect(stored.USAW).toEqual({
      Senior: {
        Men: [{ weightClass: "89kg", snatchRecord: 170, cjRecord: 210, totalRecord: 380 }],
        Women: [],
      },
    });
  });

  it("rejects an empty table rather than storing nothing over a real download", async () => {
    await AsyncStorage.setItem(OFFLINE_CACHE_KEYS.records, oldEntry);
    mockRespond.mockResolvedValue([recordRow({ record_type: null })]);

    await expect(downloadRecordsForOffline()).rejects.toThrow("no federations");
    await expect(AsyncStorage.getItem(OFFLINE_CACHE_KEYS.records)).resolves.toBe(oldEntry);
  });
});

describe("downloadWSORecordsForOffline", () => {
  it("keeps the whole stored copy when one WSO fails part way", async () => {
    await AsyncStorage.setItem(OFFLINE_CACHE_KEYS.wsoRecords, oldEntry);
    mockRespond.mockImplementation(async (path, query) => {
      if (path === "/data/wso/") return ["Carolina", "Florida"];
      if (query.wso === "Florida") throw new Error("MeetCal API error 500");
      return [];
    });

    await expect(downloadWSORecordsForOffline()).rejects.toThrow();
    await expect(AsyncStorage.getItem(OFFLINE_CACHE_KEYS.wsoRecords)).resolves.toBe(oldEntry);
  });

  it("fetches WSOs one at a time and writes them once", async () => {
    let active = 0;
    let peak = 0;
    mockRespond.mockImplementation(async (path) => {
      if (path === "/data/wso/") return ["Carolina", "Florida", "Texas"];
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return [];
    });
    const setItem = jest.spyOn(AsyncStorage, "setItem");

    await downloadWSORecordsForOffline();

    expect(peak).toBe(1);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(Object.keys((await readData(OFFLINE_CACHE_KEYS.wsoRecords)) as object)).toEqual([
      "Carolina",
      "Florida",
      "Texas",
    ]);
  });

  it("rejects an empty or oversized WSO list without per-WSO requests", async () => {
    mockRespond.mockResolvedValueOnce([]);
    await expect(downloadWSORecordsForOffline()).rejects.toThrow("no WSOs");

    const tooMany = Array.from({ length: MAX_OFFLINE_WSO_COUNT + 1 }, (_, i) => `WSO ${i}`);
    mockRespond.mockResolvedValueOnce(tooMany);
    await expect(downloadWSORecordsForOffline()).rejects.toThrow(`more than ${MAX_OFFLINE_WSO_COUNT}`);

    expect(mockRespond).toHaveBeenCalledTimes(2);
    await expect(AsyncStorage.getItem(OFFLINE_CACHE_KEYS.wsoRecords)).resolves.toBeNull();
  });
});

describe("downloadIntlRankingsForOffline", () => {
  it("rejects an empty table and keeps the stored rankings", async () => {
    await AsyncStorage.setItem(OFFLINE_CACHE_KEYS.intlRankings, oldEntry);
    mockRespond.mockResolvedValue([]);

    await expect(downloadIntlRankingsForOffline()).rejects.toThrow("no rows");
    await expect(AsyncStorage.getItem(OFFLINE_CACHE_KEYS.intlRankings)).resolves.toBe(oldEntry);
  });
});
