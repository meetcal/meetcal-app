/**
 * The `download*ForOffline` writers behind "Download" and "Refresh All".
 *
 * Unlike the browse fetchers they must never fall back to the cached copy:
 * a refresh that could not reach the API has to *fail*, so the refresh can
 * report it, and must leave the stored copy exactly as it was.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { downloadQualifyingTotalsForOffline } from "@/lib/database/fetch-qualifying-totals";
import { downloadAdaptiveRecordsForOffline } from "@/lib/database/fetch-adaptive-records";
import { jsonFetchStub } from "@/lib/api/json-fetch-stub";
import { OFFLINE_CACHE_KEYS } from "@/lib/database/offline-cache";
import { downloadStandardsForOffline } from "@/lib/database/fetch-standards";
import { downloadRecordsForOffline } from "@/lib/database/fetch-records";
import {
  downloadWSORecordsForOffline,
  MAX_OFFLINE_WSO_COUNT,
} from "@/lib/database/fetch-wso-records";
import { downloadIntlRankingsForOffline } from "@/lib/database/fetchIntlRankings";

const mockIsNetworkAvailable = jest.fn<Promise<boolean>, []>(async () => true);
jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: () => mockIsNetworkAvailable(),
}));

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

const standardRow = {
  age_category: "Senior",
  gender: "Men",
  weight_class: "89kg",
  standard_a: 330,
  standard_b: 310,
};

describe("downloadStandardsForOffline", () => {
  it("replaces the stored copy with the fresh table", async () => {
    await AsyncStorage.setItem(OFFLINE_CACHE_KEYS.standards, oldEntry);
    mockRespond.mockResolvedValue([standardRow]);
    await downloadStandardsForOffline();
    const stored = (await readData(OFFLINE_CACHE_KEYS.standards)) as {
      senior: { men: unknown[] };
    };
    expect(stored.senior.men).toEqual([{ weightClass: "89kg", a: 330, b: 310 }]);
  });

  // An empty answer (a backend reload in progress, or every row missing its
  // keys) mapped to four empty groups and was written over a real download;
  // Refresh All then said "Refresh Complete".
  it("rejects an empty or all-malformed table and keeps the stored copy", async () => {
    await AsyncStorage.setItem(OFFLINE_CACHE_KEYS.standards, oldEntry);
    mockRespond.mockResolvedValueOnce([]);
    await expect(downloadStandardsForOffline()).rejects.toThrow("no rows");
    mockRespond.mockResolvedValueOnce([{ ...standardRow, gender: null }]);
    await expect(downloadStandardsForOffline()).rejects.toThrow("no rows");
    await expect(AsyncStorage.getItem(OFFLINE_CACHE_KEYS.standards)).resolves.toBe(oldEntry);
  });

  it("rejects on an API failure and leaves the stored copy", async () => {
    await AsyncStorage.setItem(OFFLINE_CACHE_KEYS.standards, oldEntry);
    mockRespond.mockRejectedValue(new Error("Network request failed"));

    // Never the cached copy: a refresh that reached nothing must fail, not
    // report "Refresh Complete".
    await expect(downloadStandardsForOffline()).rejects.toThrow();
    await expect(AsyncStorage.getItem(OFFLINE_CACHE_KEYS.standards)).resolves.toBe(oldEntry);
  });

  it("rejects when offline without calling the API", async () => {
    mockIsNetworkAvailable.mockResolvedValue(false);
    await expect(downloadStandardsForOffline()).rejects.toThrow("Offline");
    expect(mockRespond).not.toHaveBeenCalled();
  });

  it("rejects when the write fails instead of reporting it stored", async () => {
    mockRespond.mockResolvedValue([standardRow]);
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

describe("downloadQualifyingTotalsForOffline", () => {
  const totalRow = {
    event_name: "Nationals",
    age_category: "Senior",
    gender: "Men",
    weight_class: "89kg",
    qualifying_total: 250,
  };

  it("replaces the stored copy with the fresh table", async () => {
    await AsyncStorage.setItem(OFFLINE_CACHE_KEYS.qualifyingTotals, oldEntry);
    mockRespond.mockResolvedValue([totalRow]);
    await downloadQualifyingTotalsForOffline();
    await expect(readData(OFFLINE_CACHE_KEYS.qualifyingTotals)).resolves.toEqual({
      Nationals: { Senior: { Men: { "89kg": 250 }, Women: {} } },
    });
  });

  it("rejects an empty or all-malformed table and keeps the stored copy", async () => {
    await AsyncStorage.setItem(OFFLINE_CACHE_KEYS.qualifyingTotals, oldEntry);
    mockRespond.mockResolvedValueOnce([]);
    await expect(downloadQualifyingTotalsForOffline()).rejects.toThrow("no rows");
    mockRespond.mockResolvedValueOnce([{ ...totalRow, gender: "Mixed" }]);
    await expect(downloadQualifyingTotalsForOffline()).rejects.toThrow("no rows");
    await expect(AsyncStorage.getItem(OFFLINE_CACHE_KEYS.qualifyingTotals)).resolves.toBe(oldEntry);
  });
});

describe("downloadAdaptiveRecordsForOffline", () => {
  const adaptiveRow = { weight_class: "73", snatch: 100, cj: 120, total: 220 };

  it("stores both genders, replacing the stored copy", async () => {
    await AsyncStorage.setItem(OFFLINE_CACHE_KEYS.adaptiveRecords, oldEntry);
    mockRespond.mockImplementation(async (_path, query) =>
      query.gender === "Men" ? [adaptiveRow] : [],
    );
    await downloadAdaptiveRecordsForOffline();
    await expect(readData(OFFLINE_CACHE_KEYS.adaptiveRecords)).resolves.toEqual({
      Adaptive: {
        Men: [{ weightClass: "73kg", snatchRecord: 100, cjRecord: 120, totalRecord: 220 }],
        Women: [],
      },
    });
  });

  it("rejects when neither gender has a record and keeps the stored copy", async () => {
    await AsyncStorage.setItem(OFFLINE_CACHE_KEYS.adaptiveRecords, oldEntry);
    mockRespond.mockResolvedValue([{ ...adaptiveRow, weight_class: null }]);
    await expect(downloadAdaptiveRecordsForOffline()).rejects.toThrow("no rows");
    await expect(AsyncStorage.getItem(OFFLINE_CACHE_KEYS.adaptiveRecords)).resolves.toBe(oldEntry);
  });
});

// Every downloader writes through replaceOfflineCache, which rejects on a
// failed write. Only standards had a test for it, so switching any of the
// other five back to the swallowing setOfflineCache went unnoticed, and
// Refresh All would say "Refresh Complete" over a write that never landed.
describe("a failed storage write", () => {
  const validAnswer = async (path: string, query: Record<string, string>): Promise<unknown> => {
    if (path === "/data/wso/") return ["Carolina"];
    if (path.includes("wso")) return [];
    if (path.includes("adaptive")) {
      return query.gender === "Men" ? [{ weight_class: "73", snatch: 100, cj: 120, total: 220 }] : [];
    }
    if (path.includes("qualifying")) {
      return [{ event_name: "Nationals", age_category: "Senior", gender: "Men", weight_class: "89kg", qualifying_total: 250 }];
    }
    if (path.includes("intl") || path.includes("rankings")) {
      return [{ meet: "Worlds", ranking: 1, name: "Athlete A", weight_class: "89kg", total: 380, percent_a: 101.5, gender: "Men", age_category: "Senior" }];
    }
    if (path.includes("records")) return [recordRow({})];
    return [standardRow];
  };

  it.each([
    ["standards", downloadStandardsForOffline, OFFLINE_CACHE_KEYS.standards],
    ["records", downloadRecordsForOffline, OFFLINE_CACHE_KEYS.records],
    ["WSO records", downloadWSORecordsForOffline, OFFLINE_CACHE_KEYS.wsoRecords],
    ["international rankings", downloadIntlRankingsForOffline, OFFLINE_CACHE_KEYS.intlRankings],
    ["qualifying totals", downloadQualifyingTotalsForOffline, OFFLINE_CACHE_KEYS.qualifyingTotals],
    ["adaptive records", downloadAdaptiveRecordsForOffline, OFFLINE_CACHE_KEYS.adaptiveRecords],
  ] as const)("%s: rejects and keeps the stored copy", async (_name, download, key) => {
    await AsyncStorage.setItem(key, oldEntry);
    mockRespond.mockImplementation(validAnswer);
    // The answer is usable: without the write failure the download succeeds.
    await download();
    await AsyncStorage.setItem(key, oldEntry);

    jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("SQLITE_FULL"));
    await expect(download()).rejects.toThrow("SQLITE_FULL");
    await expect(AsyncStorage.getItem(key)).resolves.toBe(oldEntry);
  });
});
