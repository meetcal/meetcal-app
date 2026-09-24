jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
    multiSet: jest.fn(async () => undefined),
    multiGet: jest.fn(async () => []),
    multiRemove: jest.fn(async () => undefined),
  },
}));

jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(async () => true),
}));

const mockFetchSchedule = jest.fn();
const mockFetchAthletesWithSession = jest.fn();
const mockFetchApiMeetPackage = jest.fn();
// Wraps the package mock as a fresh conditional response by default, so tests
// that only care about the package body keep driving `mockFetchApiMeetPackage`.
type MockPackageFetch =
  | { status: "fresh"; etag: string | null; package: unknown }
  | { status: "not_modified" };
const mockFetchApiMeetPackageConditional = jest.fn(
  async (
    meet: string,
    cutoff?: string,
    _ifNoneMatch?: string | null,
  ): Promise<MockPackageFetch> => ({
    status: "fresh",
    etag: null,
    package: await mockFetchApiMeetPackage(meet, cutoff),
  }),
);
const mockFetchApiResultsByNames = jest.fn(
  async (_names: string[]): Promise<any[]> => [],
);
const mockSaveAthleteHistory = jest.fn(async () => undefined);
const mockSaveMeetSchedule = jest.fn(async () => undefined);
const mockSaveMeetAthletes = jest.fn(async () => undefined);
// Every roster name has a history blob unless a test says otherwise.
const mockFindAthleteNamesWithoutHistory = jest.fn(
  async (_names: readonly string[]): Promise<string[]> => [],
);
// Single source of truth for "did the user download this meet for offline
// use". Both accessors read it so a test can set it once regardless of whether
// production code asks per meet or asks for the whole set.
let mockIsExplicitlyDownloaded: (meet: string) => boolean = () => true;
const setExplicitlyDownloaded = (predicate: (meet: string) => boolean) => {
  mockIsExplicitlyDownloaded = predicate;
};
const mockClearMeetData = jest.fn(
  async (_meet: string): Promise<void> => undefined,
);

function isoDateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split("T")[0];
}

jest.mock("@/lib/database/queries", () => ({
  fetchSchedule: (...args: unknown[]) => mockFetchSchedule(...args),
  fetchAthletesWithSession: (...args: unknown[]) =>
    mockFetchAthletesWithSession(...args),
}));

jest.mock("@/lib/api/meetcal-api", () => {
  const actual = jest.requireActual("@/lib/api/meetcal-api");
  return {
    ...actual,
    fetchApiMeetPackageConditional: (...args: unknown[]) =>
      mockFetchApiMeetPackageConditional(
        ...(args as [string, string | undefined, string | null | undefined]),
      ),
    fetchApiResultsByNames: (...args: unknown[]) =>
      mockFetchApiResultsByNames(...(args as [string[]])),
  };
});

jest.mock("@/lib/database/offline-store", () => ({
  clearImplicitMeetData: jest.fn(async () => undefined),
  clearMeetData: (...args: unknown[]) => mockClearMeetData.apply(null, args),
  getMeetData: jest.fn(async () => ({
    schedule: null,
    scheduleKey: "",
    athletesKey: "",
    athletes: [],
    liftingResultsKey: "",
    lastSyncTime: 0,
  })),
  isMeetExplicitlyDownloaded: async (meet: string) =>
    mockIsExplicitlyDownloaded(meet),
  getExplicitlyDownloadedMeetIds: async () => ({
    has: (meet: string) => mockIsExplicitlyDownloaded(meet),
  }),
  saveAthleteHistory: (...args: unknown[]) =>
    mockSaveAthleteHistory.apply(null, args),
  saveAthleteBestsBatch: jest.fn(async () => undefined),
  saveMeetAthletes: (...args: unknown[]) =>
    mockSaveMeetAthletes.apply(null, args),
  saveMeetLiftingResults: jest.fn(async () => undefined),
  saveMeetSchedule: (...args: unknown[]) =>
    mockSaveMeetSchedule.apply(null, args),
  findAthleteNamesWithoutHistory: (names: readonly string[]) =>
    mockFindAthleteNamesWithoutHistory(names),
  PACKAGE_ETAG_STORAGE_KEY: "@meet_package_etag_v1",
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  prefetchCriticalMeetData,
  HISTORY_REFRESH_TTL_MS,
  prefetchMeetData,
  pruneHistorySyncedAt,
  touchMeetAccess,
  validatePrefetchedLiftingResults,
  warmMeetData,
} from "@/lib/database/meet-manager";
import type { Schedule } from "@/types/schedule";

const mockGetItem = AsyncStorage.getItem as jest.Mock;

describe("validatePrefetchedLiftingResults", () => {
  it("does not throw when a meet has athletes but no results yet", () => {
    // An upcoming meet has a full roster and zero results. The production
    // caller skips the check entirely in that case; keep the function itself
    // agreeing with it.
    expect(() =>
      validatePrefetchedLiftingResults("Test Meet" as any, ["Athlete A"], []),
    ).not.toThrow();
  });

  it("does not throw when there are no athletes", () => {
    expect(() =>
      validatePrefetchedLiftingResults("Test Meet" as any, [], []),
    ).not.toThrow();
  });

  it("does not throw when lifting results are present", () => {
    expect(() =>
      validatePrefetchedLiftingResults(
        "Test Meet" as any,
        ["Athlete A"],
        [{ name: "Athlete A" }],
      ),
    ).not.toThrow();
  });

  it("throws when lifting results exist but none match athlete names", () => {
    expect(() =>
      validatePrefetchedLiftingResults(
        "Test Meet" as any,
        ["Athlete A"],
        [{ name: "Different Athlete" }],
      ),
    ).toThrow("No matched lifting results fetched for meet athletes: Test Meet");
  });

  it("accepts normalized name matches", () => {
    expect(() =>
      validatePrefetchedLiftingResults(
        "Test Meet" as any,
        [" Athlete A "],
        [{ name: "athlete   a" }],
      ),
    ).not.toThrow();
  });
});

describe("prefetchCriticalMeetData", () => {
  const MEETS_LIST_CACHE_KEY = "@meets_list_cache_v1";
  const roster = [
    { name: "1-Red", session: { number: 1, platform: "Red" } },
    { name: "2-Blue", session: { number: 2, platform: "Blue" } },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchAthletesWithSession.mockResolvedValue(roster);
    mockFetchApiMeetPackage.mockResolvedValue({
      meet: {},
      schedule: [],
      athletes: [],
      meet_results: [],
      recent_results_by_name: {},
      year_bests_by_name: {},
    });
  });

  afterEach(() => {
    mockGetItem.mockImplementation(async () => null);
  });

  it("issues one roster request and no per-session duplicates of it", async () => {
    const schedule: Schedule = [
      {
        date: "Future Day 1",
        fullDate: "2099-01-01",
        sessions: Array.from({ length: 3 }, (_, sessionIndex) => ({
          id: `session-${sessionIndex + 1}`,
          number: sessionIndex + 1,
          startTime: "8:00 AM",
          weighInTime: "6:00 AM",
          platforms: ["Red", "White", "Blue"].map((platform) => ({
            platform: platform as "Red" | "White" | "Blue",
            weightClass: `${platform} class`,
          })),
        })),
      },
    ];
    mockFetchSchedule.mockResolvedValue(schedule);

    await prefetchCriticalMeetData("Test Meet" as any);

    expect(mockFetchSchedule).toHaveBeenCalledWith("Test Meet", null);
    expect(mockSaveMeetSchedule).toHaveBeenCalledWith("Test Meet", schedule);
    // The per-session caches are derived from this single roster write
    // (`saveMeetAthletes` -> `saveSessionAthleteCaches`); the eight
    // `/meets/athletes-sessions` calls that used to "warm" them only
    // repeated the same rows.
    expect(mockFetchAthletesWithSession).toHaveBeenCalledTimes(1);
    expect(mockFetchAthletesWithSession).toHaveBeenCalledWith("Test Meet");
    expect(mockSaveMeetAthletes).toHaveBeenCalledWith("Test Meet", roster);
  });

  it("hands the cached meet to the schedule fetch so no details request rides along", async () => {
    const cachedMeet = {
      id: "m1",
      name: "Test Meet",
      dates: { start: "2099-01-01", end: "2099-01-02" },
      time: { timeZoneIdentifier: "America/Chicago" },
    };
    mockGetItem.mockImplementation(async (key: string) =>
      key === MEETS_LIST_CACHE_KEY ? JSON.stringify([cachedMeet]) : null,
    );
    mockFetchSchedule.mockResolvedValue([]);

    await prefetchCriticalMeetData("Test Meet" as any);

    expect(mockFetchSchedule).toHaveBeenCalledWith(
      "Test Meet",
      expect.objectContaining({ name: "Test Meet" }),
    );
  });

  it("defers full meet package prefetch for explicitly downloaded meets", async () => {
    jest.useFakeTimers();
    setExplicitlyDownloaded(() => true);
    const schedule: Schedule = [
      {
        date: "Future Day 1",
        fullDate: "2099-01-01",
        sessions: [
          {
            id: "session-1",
            number: 1,
            startTime: "8:00 AM",
            weighInTime: "6:00 AM",
            platforms: [
              { platform: "Red", weightClass: "Red class" },
            ],
          },
        ],
      },
    ];
    mockFetchSchedule.mockResolvedValue(schedule);

    try {
      await warmMeetData("Test Meet" as any);

      expect(mockSaveMeetAthletes).toHaveBeenCalledWith("Test Meet", roster);
      expect(mockFetchApiMeetPackage).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(4999);
      expect(mockFetchApiMeetPackage).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      expect(mockFetchApiMeetPackage).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("skips the full meet package prefetch when the meet is not explicitly downloaded", async () => {
    jest.useFakeTimers();
    setExplicitlyDownloaded(() => false);
    const schedule: Schedule = [
      {
        date: "Future Day 1",
        fullDate: "2099-01-01",
        sessions: [
          {
            id: "session-1",
            number: 1,
            startTime: "8:00 AM",
            weighInTime: "6:00 AM",
            platforms: [
              { platform: "Red", weightClass: "Red class" },
            ],
          },
        ],
      },
    ];
    mockFetchSchedule.mockResolvedValue(schedule);

    try {
      await warmMeetData("Test Meet" as any);

      // The roster (and with it the session caches) still warms, but the
      // heavy history package never runs.
      expect(mockSaveMeetAthletes).toHaveBeenCalledWith("Test Meet", roster);

      await jest.advanceTimersByTimeAsync(10000);
      expect(mockFetchApiMeetPackage).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("full athlete history download", () => {
  const buildAthlete = (name: string) => ({
    member_id: name,
    name,
    age: 25,
    club: "Club",
    wso: null,
    gender: "Male",
    weight_class: "81",
    entry_total: 0,
    adaptive: false,
    session: null,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchApiResultsByNames.mockResolvedValue([]);
  });

  it("caches each athlete's full history from /by-names, not the capped recent window", async () => {
    mockFetchApiMeetPackage.mockResolvedValue({
      meet: {},
      schedule: [],
      athletes: [buildAthlete("Athlete A"), buildAthlete("Athlete B"), buildAthlete("Athlete C")],
      meet_results: [{ name: "Athlete A" }],
      // Intentionally a capped/partial window — must be ignored in favour of the
      // full /by-names history below.
      recent_results_by_name: {
        "Athlete A": [{ name: "Athlete A", date: "2025-01-01" }],
      },
      year_bests_by_name: {},
    });
    mockFetchApiResultsByNames.mockResolvedValue([
      { name: "Athlete A", date: "2025-06-01" },
      { name: "Athlete A", date: "2014-06-01" },
      { name: "Athlete B", date: "2010-06-01" },
    ]);

    await prefetchMeetData("History Meet A" as any);

    expect(mockFetchApiResultsByNames).toHaveBeenCalledTimes(1);
    expect(mockFetchApiResultsByNames).toHaveBeenCalledWith([
      "Athlete A",
      "Athlete B",
      "Athlete C",
    ]);

    // Athlete A gets its full multi-year history (2025 + 2014), not the single
    // 2025 row from recent_results_by_name.
    expect(mockSaveAthleteHistory).toHaveBeenCalledWith("Athlete A", [
      { name: "Athlete A", date: "2025-06-01" },
      { name: "Athlete A", date: "2014-06-01" },
    ]);
    expect(mockSaveAthleteHistory).toHaveBeenCalledWith("Athlete B", [
      { name: "Athlete B", date: "2010-06-01" },
    ]);
    // Athletes with no returned rows are still written (empty history).
    expect(mockSaveAthleteHistory).toHaveBeenCalledWith("Athlete C", []);
  });

  it("fetches history in sequential batches to keep peak memory bounded", async () => {
    const athleteNames = Array.from({ length: 50 }, (_, i) => `Athlete ${i + 1}`);
    mockFetchApiMeetPackage.mockResolvedValue({
      meet: {},
      schedule: [],
      athletes: athleteNames.map(buildAthlete),
      meet_results: [{ name: "Athlete 1" }],
      recent_results_by_name: {},
      year_bests_by_name: {},
    });

    await prefetchMeetData("History Meet B" as any);

    // 50 athletes / batch size 40 (one `/by-names` request) => 2 batches.
    expect(mockFetchApiResultsByNames).toHaveBeenCalledTimes(2);
    expect(mockFetchApiResultsByNames.mock.calls[0][0]).toHaveLength(40);
    expect(mockFetchApiResultsByNames.mock.calls[1][0]).toHaveLength(10);
    expect(mockSaveAthleteHistory).toHaveBeenCalledTimes(50);
  });

  it("re-runs the whole ingest, history included, after a SQLITE_FULL cleanup", async () => {
    const pkg = {
      meet: {},
      schedule: [],
      athletes: [buildAthlete("Athlete A")],
      meet_results: [{ name: "Athlete A" }],
      recent_results_by_name: {},
      year_bests_by_name: {},
    };
    mockFetchApiMeetPackageConditional
      .mockResolvedValueOnce({ status: "fresh", etag: '"first"', package: pkg })
      .mockResolvedValueOnce({ status: "fresh", etag: '"retry"', package: pkg });
    mockSaveMeetAthletes.mockRejectedValueOnce(new Error("SQLITE_FULL"));
    mockFetchApiResultsByNames.mockResolvedValue([{ name: "Athlete A", date: "2025-01-01" }]);

    await prefetchMeetData("Recovery Meet A" as any);

    expect(mockSaveMeetAthletes).toHaveBeenCalledTimes(2);
    // The recovery used to restore only `meet_results`; the athlete history
    // must be downloaded on the retry too.
    expect(mockSaveAthleteHistory).toHaveBeenCalledWith("Athlete A", [
      { name: "Athlete A", date: "2025-01-01" },
    ]);
    const etagWrites = (AsyncStorage.setItem as jest.Mock).mock.calls
      .filter(([key]) => key === "@meet_package_etag_v1")
      .map(([, value]) => JSON.parse(value as string));
    expect(etagWrites[etagWrites.length - 1]).toEqual({ "Recovery Meet A": '"retry"' });
  });

  it("does not pin an ETag or report success when history fails after SQLITE_FULL recovery", async () => {
    const pkg = {
      meet: {},
      schedule: [],
      athletes: [buildAthlete("Athlete A")],
      meet_results: [{ name: "Athlete A" }],
      recent_results_by_name: {},
      year_bests_by_name: {},
    };
    mockFetchApiMeetPackageConditional
      .mockResolvedValueOnce({ status: "fresh", etag: '"first"', package: pkg })
      .mockResolvedValueOnce({ status: "fresh", etag: '"retry"', package: pkg });
    mockSaveMeetAthletes.mockRejectedValueOnce(new Error("SQLITE_FULL"));
    mockSaveAthleteHistory.mockRejectedValueOnce(new Error("SQLITE_FULL"));

    await expect(prefetchMeetData("Recovery Meet B" as any)).rejects.toThrow(
      /athlete_history/,
    );

    const etagWrites = (AsyncStorage.setItem as jest.Mock).mock.calls
      .filter(([key]) => key === "@meet_package_etag_v1")
      .map(([, value]) => JSON.parse(value as string));
    expect(etagWrites[etagWrites.length - 1]).toEqual({});
  });

  it("reports failure instead of silently succeeding when a history write fails", async () => {
    mockFetchApiMeetPackage.mockResolvedValue({
      meet: {},
      schedule: [],
      athletes: [buildAthlete("Athlete A")],
      meet_results: [{ name: "Athlete A" }],
      recent_results_by_name: {},
      year_bests_by_name: {},
    });
    mockFetchApiResultsByNames.mockResolvedValue([
      { name: "Athlete A", date: "2025-01-01" },
    ]);
    // Simulate a SQLITE_FULL (or any) failure persisting the larger full-history
    // payload. This must surface as a rejected prefetch so the meet is not marked
    // downloaded with missing history.
    mockSaveAthleteHistory.mockRejectedValueOnce(new Error("SQLITE_FULL"));

    await expect(prefetchMeetData("History Meet C" as any)).rejects.toThrow(
      /athlete_history/,
    );
  });
});

describe("cache eviction during prefetch", () => {
  const MEET_CACHE_KEY = "@meet_cache_info";

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchAthletesWithSession.mockResolvedValue([]);
    mockFetchSchedule.mockResolvedValue([
      {
        date: "Future Day 1",
        fullDate: "2099-01-01",
        sessions: [
          {
            id: "session-1",
            number: 1,
            startTime: "8:00 AM",
            weighInTime: "6:00 AM",
            platforms: [{ platform: "Red", weightClass: "Red class" }],
          },
        ],
      },
    ] as Schedule);
  });

  afterEach(() => {
    mockGetItem.mockImplementation(async () => null);
  });

  it("drops malformed cache entries before eviction and recomputes size", async () => {
    mockGetItem.mockImplementation(async (key: string) =>
      key === MEET_CACHE_KEY ? JSON.stringify({
        totalSize: "broken",
        meets: {
          "Valid Meet": { lastAccessed: 1, size: 10 },
          "Null Meet": null,
          "Invalid Size": { lastAccessed: 2, size: "huge" },
          "Invalid Access": { lastAccessed: null, size: 10 },
        },
      }) : null,
    );
    await touchMeetAccess("New Meet");
    const calls = (AsyncStorage.setItem as jest.Mock).mock.calls;
    const [key, value] = calls[calls.length - 1];
    expect(key).toBe(MEET_CACHE_KEY);
    expect(JSON.parse(value)).toEqual({
      totalSize: 10,
      meets: {
        "Valid Meet": { lastAccessed: 1, size: 10 },
        "New Meet": { lastAccessed: expect.any(Number), size: 0 },
      },
    });
    await expect(prefetchCriticalMeetData("New Meet")).resolves.toBeUndefined();
  });

  it("evicts the least-recently-used implicit meets but keeps explicitly downloaded ones", async () => {
    const cacheInfo = {
      totalSize: 0,
      meets: {
        "Downloaded Meet": { lastAccessed: 1, size: 0 }, // oldest, but downloaded
        "Meet E": { lastAccessed: 5, size: 0 },
        "Meet D": { lastAccessed: 4, size: 0 },
        "Meet C": { lastAccessed: 3, size: 0 },
        "Meet B": { lastAccessed: 2, size: 0 },
      },
    };
    // getCacheInfo re-reads on each call; hand back a fresh copy so mutations in
    // touchMeetAccess don't bleed into the cleanup pass.
    mockGetItem.mockImplementation(async (key: string) =>
      key === MEET_CACHE_KEY ? JSON.stringify(cacheInfo) : null,
    );
    setExplicitlyDownloaded((meet) => meet === "Downloaded Meet");

    await prefetchCriticalMeetData("Meet F" as any);

    const clearedMeets = mockClearMeetData.mock.calls.map(([meet]) => meet);
    // Keeps the 3 most-recent implicit meets (E, D, C); evicts B.
    expect(clearedMeets).toContain("Meet B");
    // Never evicts the meet the user downloaded for offline use.
    expect(clearedMeets).not.toContain("Downloaded Meet");
    // Keeps the recently-accessed implicit meets.
    expect(clearedMeets).not.toContain("Meet E");
    expect(clearedMeets).not.toContain("Meet D");
    expect(clearedMeets).not.toContain("Meet C");
  });
});

describe("package revalidation with ETag", () => {
  const PACKAGE_ETAG_KEY = "@meet_package_etag_v1";
  const offlineStore = jest.requireMock("@/lib/database/offline-store");
  const mockGetMeetData = offlineStore.getMeetData as jest.Mock;
  const mockSetItem = AsyncStorage.setItem as jest.Mock;
  const emptyMeetData = {
    schedule: null,
    scheduleKey: "",
    athletesKey: "",
    athletes: [],
    liftingResultsKey: "",
    lastSyncTime: 0,
  };
  const athlete = (name: string) => ({
    member_id: name,
    name,
    age: 25,
    club: "Club",
    wso: null,
    gender: "Male",
    weight_class: "81",
    entry_total: 0,
    adaptive: false,
    session: null,
  });
  const freshPackage = {
    meet: {},
    schedule: [],
    athletes: [athlete("Athlete A")],
    meet_results: [{ name: "Athlete A" }],
    recent_results_by_name: {},
    year_bests_by_name: {},
  };

  // By default each meet's history was synced just now, so a 304 only fills
  // gaps; pass `historySyncedAt` to model an older download.
  const storedEtags = (
    etags: Record<string, string>,
    historySyncedAt: Record<string, number> = Object.fromEntries(
      Object.keys(etags).map((meet) => [meet, Date.now()]),
    ),
  ) => {
    mockGetItem.mockImplementation(async (key: string) => {
      if (key === PACKAGE_ETAG_KEY) return JSON.stringify(etags);
      if (key === "@meet_history_synced_at_v1") return JSON.stringify(historySyncedAt);
      return null;
    });
  };
  const savedEtags = (): Record<string, string>[] =>
    mockSetItem.mock.calls
      .filter(([key]) => key === PACKAGE_ETAG_KEY)
      .map(([, value]) => JSON.parse(value as string));

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchApiResultsByNames.mockResolvedValue([]);
    setExplicitlyDownloaded(() => true);
  });

  afterEach(() => {
    mockGetItem.mockImplementation(async () => null);
    mockGetMeetData.mockResolvedValue(emptyMeetData);
  });

  it("sends the stored ETag and skips every write on a trusted 304", async () => {
    storedEtags({ "Etag Meet A": '"abc"' });
    mockGetMeetData.mockResolvedValue({ ...emptyMeetData, athletes: [{ name: "Athlete A" }] });
    mockFetchApiMeetPackageConditional.mockResolvedValueOnce({ status: "not_modified" });

    await prefetchMeetData("Etag Meet A" as any);

    expect(mockFetchApiMeetPackageConditional).toHaveBeenCalledTimes(1);
    expect(mockFetchApiMeetPackageConditional.mock.calls[0][2]).toBe('"abc"');
    expect(mockSaveMeetAthletes).not.toHaveBeenCalled();
    expect(mockSaveMeetSchedule).not.toHaveBeenCalled();
    expect(mockFetchApiResultsByNames).not.toHaveBeenCalled();
    expect(mockSaveAthleteHistory).not.toHaveBeenCalled();
  });

  it("still downloads history for roster athletes whose blob is missing on a 304", async () => {
    // "Delete all offline data" and SQLITE_FULL recovery remove the history
    // but not the roster, so athletes on disk are not proof the download is.
    storedEtags({ "Etag Meet A2": '"abc"' });
    mockGetMeetData.mockResolvedValue({
      ...emptyMeetData,
      athletes: [{ name: "Athlete A" }, { name: "Athlete B" }],
    });
    mockFetchApiMeetPackageConditional.mockResolvedValueOnce({ status: "not_modified" });
    mockFindAthleteNamesWithoutHistory.mockResolvedValueOnce(["Athlete B"]);
    mockFetchApiResultsByNames.mockResolvedValue([{ name: "Athlete B", date: "2025-01-01" }]);

    await prefetchMeetData("Etag Meet A2" as any);

    expect(mockFindAthleteNamesWithoutHistory).toHaveBeenCalledWith(["Athlete A", "Athlete B"]);
    expect(mockFetchApiResultsByNames).toHaveBeenCalledTimes(1);
    expect(mockFetchApiResultsByNames).toHaveBeenCalledWith(["Athlete B"]);
    expect(mockSaveAthleteHistory).toHaveBeenCalledTimes(1);
    expect(mockSaveAthleteHistory).toHaveBeenCalledWith("Athlete B", [
      { name: "Athlete B", date: "2025-01-01" },
    ]);
    // The package itself is unchanged, so its validator stays.
    expect(mockSaveMeetAthletes).not.toHaveBeenCalled();
    expect(savedEtags()).toEqual([]);
  });

  it("refreshes every athlete's history on a 304 once the last full sync is older than the TTL", async () => {
    storedEtags(
      { "Etag Meet Stale": '"abc"' },
      { "Etag Meet Stale": Date.now() - HISTORY_REFRESH_TTL_MS - 1 },
    );
    mockGetMeetData.mockResolvedValue({
      ...emptyMeetData,
      athletes: [{ name: "Athlete A" }, { name: "Athlete B" }],
    });
    mockFetchApiMeetPackageConditional.mockResolvedValueOnce({ status: "not_modified" });

    await prefetchMeetData("Etag Meet Stale" as any);

    expect(mockFindAthleteNamesWithoutHistory).not.toHaveBeenCalled();
    expect(mockFetchApiResultsByNames).toHaveBeenCalledWith(["Athlete A", "Athlete B"]);
    const stampWrites = mockSetItem.mock.calls.filter(([key]) => key === "@meet_history_synced_at_v1");
    expect(stampWrites).toHaveLength(1);
  });

  it("re-downloads every athlete's history on a 304 when a refresh forces it, however fresh", async () => {
    // Synced just now: without the option this 304 would fetch nothing.
    storedEtags({ "Etag Meet Forced": '"abc"' });
    mockGetMeetData.mockResolvedValue({
      ...emptyMeetData,
      athletes: [{ name: "Athlete A" }, { name: "Athlete B" }],
    });
    mockFetchApiMeetPackageConditional.mockResolvedValueOnce({ status: "not_modified" });

    await prefetchMeetData("Etag Meet Forced" as any, { forceHistoryRefresh: true });

    expect(mockFetchApiMeetPackageConditional.mock.calls[0][2]).toBe('"abc"');
    expect(mockFindAthleteNamesWithoutHistory).not.toHaveBeenCalled();
    expect(mockFetchApiResultsByNames).toHaveBeenCalledWith(["Athlete A", "Athlete B"]);
    // The package is unchanged, so the roster/schedule on disk are not rewritten.
    expect(mockSaveMeetAthletes).not.toHaveBeenCalled();
    expect(mockSaveMeetSchedule).not.toHaveBeenCalled();
  });

  /** Waits (bounded) until an async step has reached the mock. */
  const untilCalled = async (mock: jest.Mock, times: number) => {
    for (let i = 0; i < 50 && mock.mock.calls.length < times; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(mock).toHaveBeenCalledTimes(times);
  };

  // A background warm-up (SyncManager / warmMeetData) of the same meet may be
  // in flight when the user taps Refresh All. Joining it would return an
  // unforced 304 that skips history, and "Refresh Complete" would be a lie.
  it("runs a forced refresh after an in-flight background prefetch instead of joining it", async () => {
    storedEtags({ "Etag Meet Joined": '"abc"' });
    mockGetMeetData.mockResolvedValue({
      ...emptyMeetData,
      athletes: [{ name: "Athlete A" }, { name: "Athlete B" }],
    });
    mockFindAthleteNamesWithoutHistory.mockResolvedValue([]);
    let answerBackground!: (value: { status: "not_modified" }) => void;
    mockFetchApiMeetPackageConditional
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerBackground = resolve;
          }),
      )
      .mockResolvedValueOnce({ status: "not_modified" });

    const background = prefetchMeetData("Etag Meet Joined" as any);
    // A second background caller joins the one in flight.
    const joined = prefetchMeetData("Etag Meet Joined" as any);
    const forced = prefetchMeetData("Etag Meet Joined" as any, { forceHistoryRefresh: true });
    await untilCalled(mockFetchApiMeetPackageConditional, 1);
    expect(mockFetchApiMeetPackageConditional).toHaveBeenCalledTimes(1);

    answerBackground({ status: "not_modified" });
    await Promise.all([background, joined, forced]);

    expect(mockFetchApiMeetPackageConditional).toHaveBeenCalledTimes(2);
    expect(mockFetchApiResultsByNames).toHaveBeenCalledWith(["Athlete A", "Athlete B"]);
  });

  it("still runs a forced refresh when the in-flight background prefetch fails", async () => {
    storedEtags({ "Etag Meet Joined Fail": '"abc"' });
    mockGetMeetData.mockResolvedValue({ ...emptyMeetData, athletes: [{ name: "Athlete A" }] });
    jest.spyOn(console, "error").mockImplementation(() => {});
    let failBackground!: (error: Error) => void;
    mockFetchApiMeetPackageConditional
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failBackground = reject;
          }),
      )
      .mockResolvedValueOnce({ status: "not_modified" });

    const background = prefetchMeetData("Etag Meet Joined Fail" as any);
    const forced = prefetchMeetData("Etag Meet Joined Fail" as any, { forceHistoryRefresh: true });
    await untilCalled(mockFetchApiMeetPackageConditional, 1);
    failBackground(new Error("MeetCal API error 503"));

    await expect(background).rejects.toThrow();
    await expect(forced).resolves.toBeUndefined();
    expect(mockFetchApiResultsByNames).toHaveBeenCalledWith(["Athlete A"]);
  });

  it("writes nothing over the stored meet when the package request fails", async () => {
    storedEtags({ "Etag Meet Down": '"abc"' });
    mockFetchApiMeetPackageConditional.mockRejectedValueOnce(new Error("MeetCal API error 503"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      prefetchMeetData("Etag Meet Down" as any, { forceHistoryRefresh: true }),
    ).rejects.toThrow(/meet_package/);

    // A refresh relies on this: the previous download is still intact.
    expect(mockSaveMeetAthletes).not.toHaveBeenCalled();
    expect(mockSaveMeetSchedule).not.toHaveBeenCalled();
    expect(mockSaveAthleteHistory).not.toHaveBeenCalled();
    expect(mockClearMeetData).not.toHaveBeenCalled();
  });

  it("reports an incomplete download when the missing history cannot be fetched on a 304", async () => {
    storedEtags({ "Etag Meet A3": '"abc"' });
    mockGetMeetData.mockResolvedValue({ ...emptyMeetData, athletes: [{ name: "Athlete A" }] });
    mockFetchApiMeetPackageConditional.mockResolvedValueOnce({ status: "not_modified" });
    mockFindAthleteNamesWithoutHistory.mockResolvedValueOnce(["Athlete A"]);
    mockFetchApiResultsByNames.mockRejectedValueOnce(new Error("network"));

    await expect(prefetchMeetData("Etag Meet A3" as any)).rejects.toThrow(/athlete_history/);
  });

  it("does not trust a 304 when the local copy is gone; refetches without the validator", async () => {
    storedEtags({ "Etag Meet B": '"abc"' });
    mockGetMeetData.mockResolvedValue(emptyMeetData);
    mockFetchApiMeetPackageConditional.mockResolvedValueOnce({ status: "not_modified" });
    mockFetchApiMeetPackage.mockResolvedValue(freshPackage);

    await prefetchMeetData("Etag Meet B" as any);

    expect(mockFetchApiMeetPackageConditional).toHaveBeenCalledTimes(2);
    expect(mockFetchApiMeetPackageConditional.mock.calls[0][2]).toBe('"abc"');
    expect(mockFetchApiMeetPackageConditional.mock.calls[1][2]).toBeNull();
    expect(mockSaveMeetAthletes).toHaveBeenCalledTimes(1);
    // The stale validator is dropped before the full refetch.
    expect(savedEtags()[0]).toEqual({});
  });

  it("persists the ETag only after a fully successful prefetch", async () => {
    mockFetchApiMeetPackageConditional.mockResolvedValueOnce({
      status: "fresh",
      etag: '"fresh-tag"',
      package: freshPackage,
    });

    await prefetchMeetData("Etag Meet C" as any);

    expect(mockFetchApiMeetPackageConditional.mock.calls[0][2]).toBeNull();
    const saved = savedEtags();
    expect(saved[saved.length - 1]).toEqual({ "Etag Meet C": '"fresh-tag"' });
  });

  it("drops the ETag when any part of the prefetch fails", async () => {
    storedEtags({ "Etag Meet D": '"old-tag"' });
    mockFetchApiMeetPackageConditional.mockResolvedValueOnce({
      status: "fresh",
      etag: '"new-tag"',
      package: freshPackage,
    });
    mockSaveAthleteHistory.mockRejectedValueOnce(new Error("SQLITE_FULL"));

    await expect(prefetchMeetData("Etag Meet D" as any)).rejects.toThrow(
      "Offline prefetch incomplete",
    );

    const saved = savedEtags();
    expect(saved[saved.length - 1]).toEqual({});
  });
  it("drops history stamps past the TTL when it records a new one", async () => {
    const now = Date.now();
    storedEtags(
      {},
      {
        "Old Meet": now - HISTORY_REFRESH_TTL_MS - 1,
        "Recent Meet": now - 1000,
      },
    );
    mockFetchApiMeetPackageConditional.mockResolvedValueOnce({
      status: "fresh",
      etag: '"t"',
      package: freshPackage,
    });

    await prefetchMeetData("Etag Meet Prune" as any);

    const stampWrites = mockSetItem.mock.calls.filter(([key]) => key === "@meet_history_synced_at_v1");
    expect(stampWrites).toHaveLength(1);
    const written = JSON.parse(stampWrites[0][1] as string);
    expect(Object.keys(written).sort()).toEqual(["Etag Meet Prune", "Recent Meet"]);
  });

  it("drops corrupt stored ETags instead of carrying them forward", async () => {
    mockGetItem.mockImplementation(async (key: string) =>
      key === PACKAGE_ETAG_KEY
        ? JSON.stringify({ "Good Meet": '"g"', "Bad Meet": 42, "Empty Meet": "" })
        : null,
    );
    mockFetchApiMeetPackageConditional.mockResolvedValueOnce({
      status: "fresh",
      etag: '"new"',
      package: freshPackage,
    });

    await prefetchMeetData("Etag Meet E" as any);

    const saved = savedEtags();
    expect(saved[saved.length - 1]).toEqual({ "Good Meet": '"g"', "Etag Meet E": '"new"' });
  });
});

describe("pruneHistorySyncedAt", () => {
  it("keeps stamps younger than the TTL and drops the rest", () => {
    const now = 10 * HISTORY_REFRESH_TTL_MS;
    expect(
      pruneHistorySyncedAt(
        {
          fresh: now - 1,
          edge: now - HISTORY_REFRESH_TTL_MS,
          old: now - HISTORY_REFRESH_TTL_MS - 1,
        },
        now,
      ),
    ).toEqual({ fresh: now - 1 });
  });

  it("returns an empty map for no stamps", () => {
    expect(pruneHistorySyncedAt({}, Date.now())).toEqual({});
  });
});
