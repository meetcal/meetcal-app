import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  fetchMeetsFresh,
  getCachedMeets,
  prefetchCriticalMeetData,
  HISTORY_DEFERRED_RETRY_DELAY_MS,
  HISTORY_REFRESH_TTL_MS,
  HISTORY_RETRY_AFTER_DEFAULT_MS,
  HISTORY_RETRY_AFTER_MAX_MS,
  historyRetryDelayMs,
  planHistoryDownload,
  namesWithChangedPackageData,
  prefetchMeetData,
  pruneHistorySyncedAt,
  prunePendingHistory,
  touchMeetAccess,
  validatePrefetchedLiftingResults,
  warmMeetData,
} from "@/lib/database/meet-manager";
import type { Schedule } from "@/types/schedule";
import { mapApiLiftingResult } from "@/lib/api/meetcal-api";

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
const mockFetchApiMeets = jest.fn(async (): Promise<unknown[]> => []);
// Per-athlete view of the batched history write, so assertions can still
// name an athlete and its rows; the batch itself is counted separately.
const mockSaveAthleteHistory = jest.fn(async () => undefined);
const mockSaveAthleteHistoryBatch = jest.fn(
  async (entries: readonly { name: string; results: unknown[] }[]): Promise<number> => {
    for (const entry of entries) {
      await (mockSaveAthleteHistory as jest.Mock)(entry.name, entry.results);
    }
    return entries.length;
  },
);
const mockPruneOrphanedAthleteHistory = jest.fn(
  async (_options?: { keepNames?: readonly string[] }): Promise<number> => 0,
);
const mockClearImplicitMeetData = jest.fn(async (_meet?: string): Promise<void> => undefined);
const mockSaveMeetSchedule = jest.fn(async () => undefined);
// `saveMeetAthletes` reports whether it stored the roster (false: refused an empty one).
const mockSaveMeetAthletes = jest.fn(async (): Promise<boolean> => true);
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
// The stored copy a changed package is compared against: nothing by default.
const mockGetMeetLiftingResults = jest.fn(async (_meet: string): Promise<any[]> => []);
const mockGetStoredAthleteBestsForNames = jest.fn(
  async (_names: readonly string[]): Promise<Record<string, { bests: unknown }>> => ({}),
);
const mockClearMeetData = jest.fn(
  async (_meet: string): Promise<void> => undefined,
);

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
    fetchApiMeets: () => mockFetchApiMeets(),
  };
});

jest.mock("@/lib/database/offline-store", () => ({
  clearImplicitMeetData: (...args: unknown[]) =>
    mockClearImplicitMeetData(...(args as [string | undefined])),
  pruneOrphanedAthleteHistory: (...args: unknown[]) =>
    mockPruneOrphanedAthleteHistory(...(args as [{ keepNames?: readonly string[] } | undefined])),
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
  saveAthleteHistoryBatch: (entries: readonly { name: string; results: unknown[] }[]) =>
    mockSaveAthleteHistoryBatch(entries),
  saveAthleteBestsBatch: jest.fn(async () => undefined),
  saveMeetAthletes: (...args: unknown[]) =>
    mockSaveMeetAthletes.apply(null, args),
  saveMeetLiftingResults: jest.fn(async () => undefined),
  saveMeetSchedule: (...args: unknown[]) =>
    mockSaveMeetSchedule.apply(null, args),
  findAthleteNamesWithoutHistory: (names: readonly string[]) =>
    mockFindAthleteNamesWithoutHistory(names),
  getMeetLiftingResults: (meet: string) => mockGetMeetLiftingResults(meet),
  getStoredAthleteBestsForNames: (names: readonly string[]) => mockGetStoredAthleteBestsForNames(names),
  PACKAGE_ETAG_STORAGE_KEY: "@meet_package_etag_v1",
}));

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

    expect(mockFetchSchedule).toHaveBeenCalledWith("Test Meet");
    expect(mockSaveMeetSchedule).toHaveBeenCalledWith("Test Meet", schedule);
    // The per-session caches are derived from this single roster write
    // (`saveMeetAthletes` -> `saveSessionAthleteCaches`); the eight
    // `/meets/athletes-sessions` calls that used to "warm" them only
    // repeated the same rows.
    expect(mockFetchAthletesWithSession).toHaveBeenCalledTimes(1);
    expect(mockFetchAthletesWithSession).toHaveBeenCalledWith("Test Meet");
    expect(mockSaveMeetAthletes).toHaveBeenCalledWith("Test Meet", roster);
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
    // One storage batch per network batch, never one write per athlete.
    expect(mockSaveAthleteHistoryBatch).toHaveBeenCalledTimes(2);
    expect(mockSaveAthleteHistoryBatch.mock.calls[0][0]).toHaveLength(40);
    expect(mockSaveAthleteHistoryBatch.mock.calls[1][0]).toHaveLength(10);
  });

  it("waits once for Retry-After on a 429 mid-download and then completes", async () => {
    jest.useFakeTimers();
    try {
      const { MeetCalApiError } = jest.requireActual("@/lib/api/meetcal-api");
      const athleteNames = Array.from({ length: 100 }, (_, i) => `Athlete ${i + 1}`);
      mockFetchApiMeetPackage.mockResolvedValue({
        meet: {},
        schedule: [],
        athletes: athleteNames.map(buildAthlete),
        meet_results: [{ name: "Athlete 1" }],
        recent_results_by_name: {},
        year_bests_by_name: {},
      });
      const limited = new MeetCalApiError("POST /lifting-results/by-names failed with 429", 429, "");
      (limited as { retryAfterSeconds?: number }).retryAfterSeconds = 1;
      mockFetchApiResultsByNames
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(limited)
        .mockResolvedValueOnce([{ name: "Athlete 41", date: "2025-01-01" }])
        .mockResolvedValueOnce([]);

      const prefetch = prefetchMeetData("History Meet Retry" as any);
      // Batch 1, then batch 2's 429: the download is now parked on the timer.
      await jest.advanceTimersByTimeAsync(0);
      expect(mockFetchApiResultsByNames).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(999);
      expect(mockFetchApiResultsByNames).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(1);
      await expect(prefetch).resolves.toBeUndefined();

      // Batch 2 was requested exactly twice; batches 1 and 3 once.
      expect(mockFetchApiResultsByNames).toHaveBeenCalledTimes(4);
      expect(mockFetchApiResultsByNames.mock.calls[1][0]).toEqual(
        mockFetchApiResultsByNames.mock.calls[2][0],
      );
      expect(mockSaveAthleteHistory).toHaveBeenCalledWith("Athlete 41", [
        { name: "Athlete 41", date: "2025-01-01" },
      ]);
      expect(mockSaveAthleteHistoryBatch).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it("marks history incomplete after a second 429 instead of retrying again", async () => {
    jest.useFakeTimers();
    try {
      const { MeetCalApiError } = jest.requireActual("@/lib/api/meetcal-api");
      mockFetchApiMeetPackage.mockResolvedValue({
        meet: {},
        schedule: [],
        athletes: [buildAthlete("Athlete A")],
        meet_results: [{ name: "Athlete A" }],
        recent_results_by_name: {},
        year_bests_by_name: {},
      });
      const limited = new MeetCalApiError("POST /lifting-results/by-names failed with 429", 429, "");
      mockFetchApiResultsByNames.mockRejectedValue(limited);

      const prefetch = prefetchMeetData("History Meet Retry Twice" as any);
      // A `void` catch handler keeps the eventual rejection from being unhandled
      // while the timers run.
      prefetch.catch(() => undefined);
      await jest.advanceTimersByTimeAsync(HISTORY_RETRY_AFTER_MAX_MS * 2);
      await expect(prefetch).rejects.toThrow(/athlete_history/);

      expect(mockFetchApiResultsByNames).toHaveBeenCalledTimes(2);
      expect(mockSaveAthleteHistoryBatch).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
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
    // Orphaned history is pruned between the cleanup and the retry, keeping
    // this meet's own athletes (their unchanged history costs no write).
    expect(mockPruneOrphanedAthleteHistory).toHaveBeenCalledTimes(1);
    expect(mockPruneOrphanedAthleteHistory).toHaveBeenCalledWith({ keepNames: ["Athlete A"] });
    const order = [
      ...mockClearImplicitMeetData.mock.invocationCallOrder.map((n) => [n, "clear"] as const),
      ...mockPruneOrphanedAthleteHistory.mock.invocationCallOrder.map((n) => [n, "prune"] as const),
      ...mockSaveMeetAthletes.mock.invocationCallOrder.map((n) => [n, "ingest"] as const),
    ]
      .sort(([a], [b]) => a - b)
      .map(([, step]) => step);
    expect(order).toEqual(["ingest", "clear", "prune", "ingest"]);
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

  it("keeps the re-ingested package's ETag but reports failure when history fails after SQLITE_FULL recovery", async () => {
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

    // The package was decomposed, so its validator is the "ingested" marker;
    // the athlete whose history failed is recorded for the retry instead.
    const etagWrites = (AsyncStorage.setItem as jest.Mock).mock.calls
      .filter(([key]) => key === "@meet_package_etag_v1")
      .map(([, value]) => JSON.parse(value as string));
    expect(etagWrites[etagWrites.length - 1]).toEqual({ "Recovery Meet B": '"retry"' });
    const pendingWrites = (AsyncStorage.setItem as jest.Mock).mock.calls
      .filter(([key]) => key === "@meet_history_pending_v1")
      .map(([, value]) => JSON.parse(value as string));
    expect(pendingWrites[pendingWrites.length - 1]).toEqual({
      "Recovery Meet B": { names: ["Athlete A"], since: expect.any(Number) },
    });
  });

  it("retries a batch that timed out once, after the rest of the pass, and completes", async () => {
    jest.useFakeTimers();
    try {
      const { MeetCalApiTimeoutError } = jest.requireActual("@/lib/api/meetcal-api");
      const athleteNames = Array.from({ length: 100 }, (_, i) => `Athlete ${i + 1}`);
      mockFetchApiMeetPackage.mockResolvedValue({
        meet: {},
        schedule: [],
        athletes: athleteNames.map(buildAthlete),
        meet_results: [{ name: "Athlete 1" }],
        recent_results_by_name: {},
        year_bests_by_name: {},
      });
      mockFetchApiResultsByNames
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new MeetCalApiTimeoutError("POST", "/lifting-results/by-names", 15000))
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ name: "Athlete 41", date: "2025-01-01" }]);

      const prefetch = prefetchMeetData("History Meet Timeout" as any);
      await jest.advanceTimersByTimeAsync(0);
      // Batches 1-3 went out in order; batch 2 waits for the end of the pass.
      expect(mockFetchApiResultsByNames).toHaveBeenCalledTimes(3);
      await jest.advanceTimersByTimeAsync(HISTORY_DEFERRED_RETRY_DELAY_MS);
      await expect(prefetch).resolves.toBeUndefined();

      expect(mockFetchApiResultsByNames).toHaveBeenCalledTimes(4);
      expect(mockFetchApiResultsByNames.mock.calls[3][0]).toEqual(
        mockFetchApiResultsByNames.mock.calls[1][0],
      );
      expect(mockSaveAthleteHistory).toHaveBeenCalledWith("Athlete 41", [
        { name: "Athlete 41", date: "2025-01-01" },
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not retry a batch whose history write failed", async () => {
    mockFetchApiMeetPackage.mockResolvedValue({
      meet: {},
      schedule: [],
      athletes: [buildAthlete("Athlete A")],
      meet_results: [{ name: "Athlete A" }],
      recent_results_by_name: {},
      year_bests_by_name: {},
    });
    mockFetchApiResultsByNames.mockResolvedValue([{ name: "Athlete A", date: "2025-01-01" }]);
    mockSaveAthleteHistory.mockRejectedValueOnce(new Error("SQLITE_FULL"));

    await expect(prefetchMeetData("History Meet Write" as any)).rejects.toThrow(/athlete_history/);
    expect(mockFetchApiResultsByNames).toHaveBeenCalledTimes(1);
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

  // The sweep wrote back the copy it read before clearing (slow), so a meet
  // opened meanwhile lost its access stamp and was never evicted again.
  it("keeps an access stamped while the sweep is clearing a meet", async () => {
    const store = useBackedStorage({
      [MEET_CACHE_KEY]: JSON.stringify({
        totalSize: 0,
        meets: {
          "Meet E": { lastAccessed: 5, size: 0 },
          "Meet D": { lastAccessed: 4, size: 0 },
          "Meet B": { lastAccessed: 2, size: 0 },
        },
      }),
    });
    setExplicitlyDownloaded(() => false);
    let releaseClear!: () => void;
    const clearGate = new Promise<void>((resolve) => {
      releaseClear = resolve;
    });
    mockClearMeetData.mockImplementationOnce(() => clearGate);

    try {
      const opening = prefetchCriticalMeetData("Meet F" as any);
      for (let i = 0; i < 50 && mockClearMeetData.mock.calls.length === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(mockClearMeetData).toHaveBeenCalledWith("Meet B");
      // Another meet is opened while "Meet B" is being cleared.
      await touchMeetAccess("Meet G" as any);
      releaseClear();
      await opening;

      const info = JSON.parse(store.get(MEET_CACHE_KEY)!);
      expect(Object.keys(info.meets).sort()).toEqual(["Meet D", "Meet E", "Meet F", "Meet G"]);
    } finally {
      resetStorageMocks();
    }
  });

  // The sweep removed the evicted meet's cache entry whatever happened
  // during its clear, so a meet reopened meanwhile lost its fresh stamp.
  it("keeps the access stamp of a meet reopened while it was being cleared", async () => {
    const store = useBackedStorage({
      [MEET_CACHE_KEY]: JSON.stringify({
        totalSize: 0,
        meets: {
          "Meet E": { lastAccessed: 5, size: 0 },
          "Meet D": { lastAccessed: 4, size: 0 },
          "Meet B": { lastAccessed: 2, size: 0 },
        },
      }),
    });
    setExplicitlyDownloaded(() => false);
    let releaseClear!: () => void;
    const clearGate = new Promise<void>((resolve) => {
      releaseClear = resolve;
    });
    mockClearMeetData.mockImplementationOnce(() => clearGate);

    try {
      const opening = prefetchCriticalMeetData("Meet F" as any);
      for (let i = 0; i < 50 && mockClearMeetData.mock.calls.length === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(mockClearMeetData).toHaveBeenCalledWith("Meet B");
      // "Meet B" itself is opened again while its clear is running.
      await touchMeetAccess("Meet B" as any);
      releaseClear();
      await opening;

      const info = JSON.parse(store.get(MEET_CACHE_KEY)!);
      expect(info.meets["Meet B"]).toEqual({ lastAccessed: expect.any(Number), size: 0 });
      expect(info.meets["Meet B"].lastAccessed).toBeGreaterThan(5);
    } finally {
      resetStorageMocks();
    }
  });

  // The in-flight check ran before the ETag write, so an open that started
  // during that write queued its saves ahead of the clear and lost them.
  it("does not evict a meet whose open starts while its ETag is being cleared", async () => {
    const store = useBackedStorage({
      [MEET_CACHE_KEY]: JSON.stringify({
        totalSize: 0,
        meets: {
          "Meet E": { lastAccessed: 5, size: 0 },
          "Meet D": { lastAccessed: 4, size: 0 },
          "Meet B": { lastAccessed: 2, size: 0 },
        },
      }),
    });
    setExplicitlyDownloaded(() => false);
    const setItem = AsyncStorage.setItem as jest.Mock;
    const backedSetItem = setItem.getMockImplementation()!;
    let releaseEtag!: () => void;
    const etagGate = new Promise<void>((resolve) => {
      releaseEtag = resolve;
    });
    let etagParked = false;
    setItem.mockImplementation(async (key: string, value: string) => {
      if (key === "@meet_package_etag_v1" && !etagParked) {
        etagParked = true;
        await etagGate;
      }
      return backedSetItem(key, value);
    });
    let releaseRoster!: (value: unknown[]) => void;
    mockFetchAthletesWithSession.mockImplementation((meet: string) =>
      meet === "Meet B"
        ? new Promise((resolve) => {
            releaseRoster = resolve;
          })
        : Promise.resolve([]),
    );

    try {
      const openingF = prefetchCriticalMeetData("Meet F" as any);
      for (let i = 0; i < 50 && !etagParked; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(etagParked).toBe(true);
      // "Meet B" is opened while the sweep is dropping its ETag.
      const openingB = prefetchCriticalMeetData("Meet B" as any);
      releaseEtag();
      await openingF;

      expect(mockClearMeetData).not.toHaveBeenCalledWith("Meet B");
      releaseRoster([]);
      await openingB;
      expect(JSON.parse(store.get(MEET_CACHE_KEY)!).meets["Meet B"]).toBeDefined();
    } finally {
      resetStorageMocks();
      mockFetchAthletesWithSession.mockResolvedValue([]);
    }
  });

  it("does not evict a meet that is being opened", async () => {
    useBackedStorage({
      [MEET_CACHE_KEY]: JSON.stringify({
        totalSize: 0,
        meets: {
          "Meet E": { lastAccessed: 5, size: 0 },
          "Meet D": { lastAccessed: 4, size: 0 },
          "Meet C": { lastAccessed: 3, size: 0 },
          "Meet B": { lastAccessed: 2, size: 0 },
        },
      }),
    });
    setExplicitlyDownloaded(() => false);
    // "Meet B"'s open is still waiting on its roster, so it has not stamped
    // its access yet.
    let releaseRoster!: (value: unknown[]) => void;
    mockFetchAthletesWithSession.mockImplementation((meet: string) =>
      meet === "Meet B"
        ? new Promise((resolve) => {
            releaseRoster = resolve;
          })
        : Promise.resolve([]),
    );

    try {
      const openingB = prefetchCriticalMeetData("Meet B" as any);
      await prefetchCriticalMeetData("Meet F" as any);

      expect(mockClearMeetData).not.toHaveBeenCalledWith("Meet B");
      releaseRoster([]);
      await openingB;
    } finally {
      resetStorageMocks();
      mockFetchAthletesWithSession.mockResolvedValue([]);
    }
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

  it("issues no history requests on a 304 while the last full sync is younger than the TTL", async () => {
    const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;
    expect(HISTORY_REFRESH_TTL_MS).toBeGreaterThan(SIX_DAYS_MS);
    storedEtags(
      { "Etag Meet Fresh Week": '"abc"' },
      { "Etag Meet Fresh Week": Date.now() - SIX_DAYS_MS },
    );
    mockGetMeetData.mockResolvedValue({
      ...emptyMeetData,
      athletes: [{ name: "Athlete A" }, { name: "Athlete B" }],
    });
    mockFetchApiMeetPackageConditional.mockResolvedValueOnce({ status: "not_modified" });

    await prefetchMeetData("Etag Meet Fresh Week" as any);

    // Only the gap check runs, and with every blob present nothing is fetched.
    expect(mockFindAthleteNamesWithoutHistory).toHaveBeenCalledWith(["Athlete A", "Athlete B"]);
    expect(mockFetchApiResultsByNames).not.toHaveBeenCalled();
    expect(mockSaveAthleteHistoryBatch).not.toHaveBeenCalled();
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
    jest.useFakeTimers();
    try {
      storedEtags({ "Etag Meet A3": '"abc"' });
      mockGetMeetData.mockResolvedValue({ ...emptyMeetData, athletes: [{ name: "Athlete A" }] });
      mockFetchApiMeetPackageConditional.mockResolvedValueOnce({ status: "not_modified" });
      mockFindAthleteNamesWithoutHistory.mockResolvedValueOnce(["Athlete A"]);
      // Fails on the pass and again on its one deferred retry.
      mockFetchApiResultsByNames.mockRejectedValue(new Error("network"));

      const prefetch = prefetchMeetData("Etag Meet A3" as any);
      prefetch.catch(() => undefined);
      await jest.advanceTimersByTimeAsync(HISTORY_DEFERRED_RETRY_DELAY_MS);
      await expect(prefetch).rejects.toThrow(/athlete_history/);
      expect(mockFetchApiResultsByNames).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  // One failed batch used to withhold the ETag, so the retry re-ingested the
  // package and re-downloaded every athlete: ~38 requests for a national meet.
  it("resumes an unfinished history refresh with only the athletes it did not reach", async () => {
    const pendingSince = Date.now() - 60_000;
    mockGetItem.mockImplementation(async (key: string) => {
      if (key === PACKAGE_ETAG_KEY) return JSON.stringify({ "Etag Meet Resume": '"abc"' });
      // The last full sync is old: without the pending list this 304 would
      // re-fetch the whole roster.
      if (key === "@meet_history_synced_at_v1") return JSON.stringify({});
      if (key === "@meet_history_pending_v1") {
        return JSON.stringify({
          "Etag Meet Resume": { names: ["Athlete C", "Withdrawn"], since: pendingSince },
        });
      }
      return null;
    });
    mockGetMeetData.mockResolvedValue({
      ...emptyMeetData,
      athletes: [{ name: "Athlete A" }, { name: "Athlete B" }, { name: "athlete  c" }],
    });
    mockFetchApiMeetPackageConditional.mockResolvedValueOnce({ status: "not_modified" });
    mockFindAthleteNamesWithoutHistory.mockResolvedValueOnce(["Athlete B"]);

    await prefetchMeetData("Etag Meet Resume" as any);

    // Pending (matched to today's roster spelling) plus any athlete with no blob.
    expect(mockFetchApiResultsByNames).toHaveBeenCalledTimes(1);
    expect(mockFetchApiResultsByNames).toHaveBeenCalledWith(["athlete  c", "Athlete B"]);
    expect(mockSaveMeetAthletes).not.toHaveBeenCalled();
    // Finishing the remainder completes the refresh: stamped, pending cleared.
    const stampWrites = mockSetItem.mock.calls.filter(([key]) => key === "@meet_history_synced_at_v1");
    expect(stampWrites).toHaveLength(1);
    const pendingWrites = mockSetItem.mock.calls
      .filter(([key]) => key === "@meet_history_pending_v1")
      .map(([, value]) => JSON.parse(value as string));
    // Recorded before the pass (an app killed mid-way resumes here), then
    // cleared once it completes.
    expect(pendingWrites).toEqual([
      { "Etag Meet Resume": { names: ["athlete  c", "Athlete B"], since: pendingSince } },
      {},
    ]);
  });

  it("saves the new ETag and the pending list before the history pass starts", async () => {
    mockFetchApiMeetPackageConditional.mockResolvedValueOnce({
      status: "fresh",
      etag: '"before-history"',
      package: freshPackage,
    });
    const writesBeforeHistory: string[] = [];
    mockFetchApiResultsByNames.mockImplementationOnce(async () => {
      writesBeforeHistory.push(...mockSetItem.mock.calls.map(([key]) => key as string));
      return [];
    });

    await prefetchMeetData("Etag Meet Early" as any);

    expect(writesBeforeHistory).toEqual(
      expect.arrayContaining([PACKAGE_ETAG_KEY, "@meet_history_pending_v1"]),
    );
    expect(savedEtags().at(-1)).toEqual({ "Etag Meet Early": '"before-history"' });
  });

  // The ETag used to be saved first: an app killed before the pending list
  // landed came back to a `304`, found no refresh owed and fetched only the
  // gaps, leaving every changed history stale.
  it("records the pending list before it saves the new ETag", async () => {
    mockFetchApiMeetPackageConditional.mockResolvedValueOnce({
      status: "fresh",
      etag: '"ordered"',
      package: freshPackage,
    });

    await prefetchMeetData("Etag Meet Ordered" as any);

    const keys = mockSetItem.mock.calls.map(([key]) => key as string);
    const firstPending = keys.indexOf("@meet_history_pending_v1");
    expect(firstPending).toBeGreaterThanOrEqual(0);
    expect(firstPending).toBeLessThan(keys.indexOf(PACKAGE_ETAG_KEY));
  });

  it("drops the new ETag when the history a changed package owes cannot be recorded", async () => {
    storedEtags({ "Etag Meet Unrecorded": '"old-tag"' });
    jest.spyOn(console, "warn").mockImplementation(() => {});
    mockFetchApiMeetPackageConditional.mockResolvedValueOnce({
      status: "fresh",
      etag: '"new-tag"',
      package: freshPackage,
    });
    const defaultSetItem = mockSetItem.getMockImplementation();
    mockSetItem.mockImplementation(async (key: string) => {
      if (key === "@meet_history_pending_v1") throw new Error("disk full");
    });

    try {
      await prefetchMeetData("Etag Meet Unrecorded" as any);
    } finally {
      mockSetItem.mockImplementation(defaultSetItem ?? (async () => undefined));
      jest.restoreAllMocks();
    }

    // No validator: the next attempt fetches the package in full and so
    // refreshes every history, rather than trusting a `304` for it.
    expect(savedEtags().at(-1)).toEqual({});
  });

  // A new package can carry new results for athletes the unfinished refresh
  // already reached: those are added to what it still owes.
  it("resumes an unfinished refresh together with a changed package's athletes", async () => {
    mockGetItem.mockImplementation(async (key: string) => {
      if (key === PACKAGE_ETAG_KEY) return JSON.stringify({ "Etag Meet Changed": '"old"' });
      if (key === "@meet_history_pending_v1") {
        return JSON.stringify({
          "Etag Meet Changed": { names: ["Athlete B"], since: Date.now() - 60_000 },
        });
      }
      return null;
    });
    mockFetchApiMeetPackageConditional.mockResolvedValueOnce({
      status: "fresh",
      etag: '"new"',
      package: { ...freshPackage, athletes: [athlete("Athlete A"), athlete("Athlete B")] },
    });

    await prefetchMeetData("Etag Meet Changed" as any);

    expect(mockFetchApiResultsByNames).toHaveBeenCalledWith(["Athlete B", "Athlete A"]);
  });

  // During a live meet every posted result changes the package tag, and each
  // open of the meet re-fetched history for the whole roster (~38 requests
  // at a national meet) though almost none of it had changed.
  it("fetches only the athletes whose results or year bests changed when a known package changes", async () => {
    mockGetItem.mockImplementation(async (key: string) => {
      if (key === PACKAGE_ETAG_KEY) return JSON.stringify({ "Etag Meet Live": '"old"' });
      if (key === "@meet_history_synced_at_v1") {
        return JSON.stringify({ "Etag Meet Live": Date.now() - 60_000 });
      }
      return null;
    });
    const unchanged = { name: "Athlete A", date: "2026-10-10", total: 200 };
    // Stored as the ingest stored it: mapped.
    mockGetMeetLiftingResults.mockResolvedValueOnce([mapApiLiftingResult(unchanged as any)]);
    mockGetStoredAthleteBestsForNames.mockResolvedValueOnce({
      "Athlete C": { bests: { snatch_best: 90, cj_best: 110, total: 200 } },
    });
    mockFetchApiMeetPackageConditional.mockResolvedValueOnce({
      status: "fresh",
      etag: '"new"',
      package: {
        ...freshPackage,
        athletes: ["Athlete A", "Athlete B", "Athlete C", "Athlete D"].map(athlete),
        meet_results: [unchanged, { name: "Athlete B", date: "2026-10-10", total: 180 }],
        year_bests_by_name: {
          "Athlete C": { best_snatch: 90, best_cj: 110, best_total: 200 },
          "Athlete D": { best_snatch: 70, best_cj: 90, best_total: 160 },
        },
      },
    });

    await prefetchMeetData("Etag Meet Live" as any);

    expect(mockFetchApiResultsByNames).toHaveBeenCalledTimes(1);
    expect([...mockFetchApiResultsByNames.mock.calls[0][0]].sort()).toEqual([
      "Athlete B",
      "Athlete D",
    ]);
    // Not a full refresh: the sync stamp is not renewed.
    const stampWrites = mockSetItem.mock.calls.filter(([key]) => key === "@meet_history_synced_at_v1");
    expect(stampWrites).toHaveLength(0);
    // Owed before the new results are saved: once they are, comparing again
    // finds nothing, so an app killed in between would never fetch them.
    const { saveMeetLiftingResults } = jest.requireMock("@/lib/database/offline-store");
    const firstPending = mockSetItem.mock.calls.findIndex(([key]) => key === "@meet_history_pending_v1");
    expect(firstPending).toBeGreaterThanOrEqual(0);
    expect(JSON.parse(mockSetItem.mock.calls[firstPending][1] as string)["Etag Meet Live"]).toMatchObject({
      names: expect.arrayContaining(["athlete b", "athlete d"]),
      full: false,
    });
    expect(mockSetItem.mock.invocationCallOrder[firstPending]).toBeLessThan(
      (saveMeetLiftingResults as jest.Mock).mock.invocationCallOrder[0],
    );
  });

  it("stores only the package's real year bests, not its zero rows", async () => {
    const saveBests = offlineStore.saveAthleteBestsBatch as jest.Mock;
    saveBests.mockClear();
    mockFetchApiMeetPackageConditional.mockResolvedValueOnce({
      status: "fresh",
      etag: null,
      package: {
        ...freshPackage,
        year_bests_by_name: {
          "Athlete A": { best_snatch: 90, best_cj: 110, best_total: 200 },
          "Not Lifted Lately": { best_snatch: 0, best_cj: 0, best_total: 0 },
        },
      },
    });

    await prefetchMeetData("Etag Meet Bests" as any);

    // A zero row stored as a fresh "no results" kept the start list from
    // falling back to the athlete's most recent meet.
    expect(saveBests).toHaveBeenCalledWith({
      "Athlete A": { snatch_best: 90, cj_best: 110, total: 200 },
    });
  });

  it("runs the history pass for the stored roster when the package's roster was refused as empty", async () => {
    mockSaveMeetAthletes.mockResolvedValueOnce(false);
    mockGetMeetData.mockResolvedValue({ ...emptyMeetData, athletes: [{ name: "Kept Athlete" }] });
    mockFetchApiMeetPackageConditional.mockResolvedValueOnce({
      status: "fresh",
      etag: null,
      package: { ...freshPackage, athletes: [], meet_results: [] },
    });

    await prefetchMeetData("Etag Meet Empty Roster" as any);

    expect(mockFetchApiResultsByNames).toHaveBeenCalledWith(["Kept Athlete"]);
  });

  it("starts over when the unfinished refresh is older than the TTL", async () => {
    mockGetItem.mockImplementation(async (key: string) => {
      if (key === PACKAGE_ETAG_KEY) return JSON.stringify({ "Etag Meet Old Pending": '"abc"' });
      if (key === "@meet_history_pending_v1") {
        return JSON.stringify({
          "Etag Meet Old Pending": {
            names: ["Athlete B"],
            since: Date.now() - HISTORY_REFRESH_TTL_MS - 1,
          },
        });
      }
      return null;
    });
    mockGetMeetData.mockResolvedValue({
      ...emptyMeetData,
      athletes: [{ name: "Athlete A" }, { name: "Athlete B" }],
    });
    mockFetchApiMeetPackageConditional.mockResolvedValueOnce({ status: "not_modified" });

    await prefetchMeetData("Etag Meet Old Pending" as any);

    expect(mockFetchApiResultsByNames).toHaveBeenCalledWith(["Athlete A", "Athlete B"]);
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

  it("keeps the new ETag once the package is ingested and records the history still owed", async () => {
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
    expect(saved[saved.length - 1]).toEqual({ "Etag Meet D": '"new-tag"' });
    const pendingWrites = mockSetItem.mock.calls
      .filter(([key]) => key === "@meet_history_pending_v1")
      .map(([, value]) => JSON.parse(value as string));
    // A changed package's athlete, owed without stamping a full sync.
    expect(pendingWrites[pendingWrites.length - 1]).toEqual({
      "Etag Meet D": { names: ["Athlete A"], since: expect.any(Number), full: false },
    });
  });

  it("drops the ETag when the package ingest itself fails", async () => {
    storedEtags({ "Etag Meet D2": '"old-tag"' });
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockFetchApiMeetPackageConditional.mockResolvedValueOnce({
      status: "fresh",
      etag: '"new-tag"',
      package: freshPackage,
    });
    mockSaveMeetAthletes.mockRejectedValueOnce(new Error("I/O error"));

    await expect(prefetchMeetData("Etag Meet D2" as any)).rejects.toThrow(/meet_package/);

    const saved = savedEtags();
    expect(saved[saved.length - 1]).toEqual({});
    // No roster was decomposed, so no history pass ran either.
    expect(mockFetchApiResultsByNames).not.toHaveBeenCalled();
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

describe("planHistoryDownload", () => {
  const now = Date.UTC(2026, 5, 20, 12);
  const roster = ["Athlete A", "Athlete B", "Athlete C"];
  const base = {
    rosterNames: roster,
    pending: undefined,
    syncedAt: now - 1000,
    packageChanged: false,
    force: false,
    now,
  };

  it("fetches only the gaps while the last full sync is fresh", async () => {
    const findMissing = jest.fn(async () => ["Athlete B"]);
    await expect(planHistoryDownload({ ...base, findMissing })).resolves.toEqual({
      names: ["Athlete B"],
      fullRefresh: false,
      since: now,
      track: false,
    });
  });

  it("fetches a changed package's athletes and the gaps, tracked but not a full refresh", async () => {
    const findMissing = jest.fn(async () => ["Athlete B"]);
    await expect(
      planHistoryDownload({
        ...base,
        packageChanged: true,
        changedNames: ["athlete a", "Not On Roster"],
        findMissing,
      }),
    ).resolves.toEqual({
      names: ["Athlete A", "Athlete B"],
      fullRefresh: false,
      since: now,
      track: true,
    });
  });

  it("still refreshes the whole roster for a changed package once the last full sync is stale", async () => {
    const findMissing = jest.fn(async () => []);
    await expect(
      planHistoryDownload({
        ...base,
        syncedAt: now - HISTORY_REFRESH_TTL_MS,
        packageChanged: true,
        changedNames: ["Athlete A"],
        findMissing,
      }),
    ).resolves.toEqual({ names: roster, fullRefresh: true, since: now, track: true });
  });

  it("resumes an unfinished changed-package pass without stamping a full sync", async () => {
    const since = now - 60_000;
    const findMissing = jest.fn(async () => []);
    await expect(
      planHistoryDownload({
        ...base,
        pending: { names: ["Athlete C"], since, full: false },
        packageChanged: true,
        changedNames: ["Athlete A"],
        findMissing,
      }),
    ).resolves.toEqual({ names: ["Athlete C", "Athlete A"], fullRefresh: false, since, track: true });
  });

  it("refreshes the whole roster for a changed package or a stale sync, without probing storage", async () => {
    const findMissing = jest.fn(async () => []);
    for (const input of [
      { ...base, packageChanged: true },
      { ...base, syncedAt: now - HISTORY_REFRESH_TTL_MS },
      { ...base, force: true },
    ]) {
      await expect(planHistoryDownload({ ...input, findMissing })).resolves.toEqual({
        names: roster,
        fullRefresh: true,
        since: now,
        track: true,
      });
    }
    expect(findMissing).not.toHaveBeenCalled();
  });

  it("resumes a young unfinished refresh with its remainder and the gaps", async () => {
    const since = now - 60_000;
    const findMissing = jest.fn(async () => ["Athlete A"]);
    await expect(
      planHistoryDownload({
        ...base,
        syncedAt: 0,
        pending: { names: ["athlete c", "Not On Roster"], since },
        findMissing,
      }),
    ).resolves.toEqual({ names: ["Athlete C", "Athlete A"], fullRefresh: true, since, track: true });
  });

  // A package new here (no copy to compare with) can carry new results for
  // athletes the unfinished refresh already reached; resuming fetched only
  // its remainder and then stamped the whole roster as current.
  it("refreshes the whole roster for a package new here, over a young unfinished refresh", async () => {
    const findMissing = jest.fn(async () => []);
    await expect(
      planHistoryDownload({
        ...base,
        packageChanged: true,
        pending: { names: ["Athlete C"], since: now - 60_000 },
        findMissing,
      }),
    ).resolves.toEqual({ names: roster, fullRefresh: true, since: now, track: true });
    expect(findMissing).not.toHaveBeenCalled();
  });

  it("ignores an unfinished refresh on Refresh All or once it is older than the TTL", async () => {
    const findMissing = jest.fn(async () => []);
    const pending = { names: ["Athlete C"], since: now - 60_000 };
    await expect(
      planHistoryDownload({ ...base, force: true, pending, findMissing }),
    ).resolves.toMatchObject({ names: roster });
    await expect(
      planHistoryDownload({
        ...base,
        syncedAt: 0,
        pending: { ...pending, since: now - HISTORY_REFRESH_TTL_MS },
        findMissing,
      }),
    ).resolves.toMatchObject({ names: roster, since: now });
  });
});

describe("prunePendingHistory", () => {
  it("drops unfinished refreshes that started a TTL or more ago", () => {
    const now = Date.now();
    expect(
      prunePendingHistory(
        {
          fresh: { names: ["A"], since: now - 1 },
          edge: { names: ["B"], since: now - HISTORY_REFRESH_TTL_MS },
        },
        now,
      ),
    ).toEqual({ fresh: { names: ["A"], since: now - 1 } });
  });
});

describe("historyRetryDelayMs", () => {
  const { MeetCalApiError } = jest.requireActual("@/lib/api/meetcal-api");
  const apiError = (status: number, retryAfterSeconds?: unknown) => {
    const error = new MeetCalApiError(`failed with ${status}`, status, "");
    if (retryAfterSeconds !== undefined) {
      (error as { retryAfterSeconds?: unknown }).retryAfterSeconds = retryAfterSeconds;
    }
    return error;
  };

  it("honors Retry-After seconds on a 429 or 503, capped", () => {
    expect(historyRetryDelayMs(apiError(429, 2))).toBe(2000);
    expect(historyRetryDelayMs(apiError(503, "3"))).toBe(3000);
    expect(historyRetryDelayMs(apiError(429, 120))).toBe(HISTORY_RETRY_AFTER_MAX_MS);
    expect(HISTORY_RETRY_AFTER_MAX_MS).toBeLessThanOrEqual(5000);
  });

  it("falls back to the default wait without a usable header", () => {
    expect(historyRetryDelayMs(apiError(429))).toBe(HISTORY_RETRY_AFTER_DEFAULT_MS);
    expect(historyRetryDelayMs(apiError(429, "Wed, 21 Oct 2026 07:28:00 GMT"))).toBe(
      HISTORY_RETRY_AFTER_DEFAULT_MS,
    );
    expect(historyRetryDelayMs(apiError(503, -1))).toBe(HISTORY_RETRY_AFTER_DEFAULT_MS);
  });

  it("does not retry other failures", () => {
    expect(historyRetryDelayMs(apiError(500, 1))).toBeNull();
    expect(historyRetryDelayMs(apiError(404))).toBeNull();
    expect(historyRetryDelayMs(new Error("network"))).toBeNull();
    expect(historyRetryDelayMs(new Error("[Request ID: 1] Server Error\nUncaught Error: bad name"))).toBeNull();
  });

  it("retries Convex's own overload failures once, after the default wait", () => {
    expect(historyRetryDelayMs(new Error("Your request couldn't be completed. Try again later."))).toBe(
      HISTORY_RETRY_AFTER_DEFAULT_MS,
    );
    expect(historyRetryDelayMs(new Error("Too many concurrent requests"))).toBe(HISTORY_RETRY_AFTER_DEFAULT_MS);
  });
});

/** Routes the AsyncStorage mock through a real map for one test. */
function useBackedStorage(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  mockGetItem.mockImplementation(async (key: string) => store.get(key) ?? null);
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
    store.set(key, value);
  });
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(async (key: string) => {
    store.delete(key);
  });
  (AsyncStorage.multiRemove as jest.Mock).mockImplementation(async (keys: string[]) => {
    keys.forEach((key) => store.delete(key));
  });
  return store;
}

function resetStorageMocks() {
  mockGetItem.mockImplementation(async () => null);
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async () => undefined);
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(async () => undefined);
  (AsyncStorage.multiRemove as jest.Mock).mockImplementation(async () => undefined);
}

describe("fetchMeetsFresh and the cached meets list", () => {
  const MEETS_LIST_CACHE_KEY = "@meets_list_cache_v1";
  const meet = (name: string) => ({
    name,
    dates: { start: "2099-06-20", end: "2099-06-22" },
    time: { timeZoneIdentifier: "America/New_York" },
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    resetStorageMocks();
  });

  it("keeps the cached list when /meets answers with no meets, but still returns none", async () => {
    const store = useBackedStorage({
      [MEETS_LIST_CACHE_KEY]: JSON.stringify([meet("Meet A"), meet("Meet B")]),
    });
    mockFetchApiMeets.mockResolvedValueOnce([]);

    await expect(fetchMeetsFresh()).resolves.toEqual([]);

    const cached = await getCachedMeets();
    expect(cached.map((m) => m.name)).toEqual(["Meet A", "Meet B"]);
    expect(JSON.parse(store.get(MEETS_LIST_CACHE_KEY) ?? "[]")).toHaveLength(2);
  });

  it("still writes a non-empty answer over the cache", async () => {
    const store = useBackedStorage({
      [MEETS_LIST_CACHE_KEY]: JSON.stringify([meet("Meet A"), meet("Meet B")]),
    });
    mockFetchApiMeets.mockResolvedValueOnce([meet("Meet C")]);

    await fetchMeetsFresh();

    expect(JSON.parse(store.get(MEETS_LIST_CACHE_KEY) ?? "[]").map((m: { name: string }) => m.name)).toEqual([
      "Meet C",
    ]);
  });

  it("writes an empty answer when there was no cache to lose", async () => {
    const store = useBackedStorage();
    mockFetchApiMeets.mockResolvedValueOnce([]);

    await fetchMeetsFresh();

    expect(store.get(MEETS_LIST_CACHE_KEY)).toBe("[]");
  });
});

describe("eviction during a full prefetch", () => {
  const MEET_CACHE_KEY = "@meet_cache_info";
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
    mockFetchAthletesWithSession.mockResolvedValue([]);
    mockFetchSchedule.mockResolvedValue([]);
    // Nothing is marked downloaded yet: the mark is written after the prefetch.
    setExplicitlyDownloaded(() => false);
  });

  afterEach(() => {
    resetStorageMocks();
    setExplicitlyDownloaded(() => true);
  });

  it("never evicts the meet whose download is in flight, and stamps its access up front", async () => {
    const store = useBackedStorage({
      [MEET_CACHE_KEY]: JSON.stringify({
        totalSize: 0,
        meets: { D: { lastAccessed: 1, size: 0 } },
      }),
    });
    mockFetchApiMeetPackage.mockResolvedValue({
      meet: {},
      schedule: [],
      athletes: [buildAthlete("Athlete D")],
      meet_results: [{ name: "Athlete D" }],
      recent_results_by_name: {},
      year_bests_by_name: {},
    });
    let finishHistory!: (rows: unknown[]) => void;
    mockFetchApiResultsByNames.mockImplementationOnce(
      () => new Promise<any[]>((resolve) => { finishHistory = resolve; }),
    );

    const startedAt = Date.now();
    const download = prefetchMeetData("D" as any);
    for (let i = 0; i < 20 && !finishHistory; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(finishHistory).toBeDefined();
    const stamped = JSON.parse(store.get(MEET_CACHE_KEY) ?? "{}").meets.D.lastAccessed;
    expect(stamped).toBeGreaterThanOrEqual(startedAt);

    // Three other meets opened while the history downloads.
    for (const other of ["E", "F", "G"]) {
      await prefetchCriticalMeetData(other as any);
    }

    const cleared = mockClearMeetData.mock.calls.map(([name]) => name);
    expect(cleared).not.toContain("D");

    finishHistory([]);
    await expect(download).resolves.toBeUndefined();
    expect(mockClearMeetData.mock.calls.map(([name]) => name)).not.toContain("D");
    expect(JSON.parse(store.get(MEET_CACHE_KEY) ?? "{}").meets.D).toBeDefined();
  });
});

describe("namesWithChangedPackageData", () => {
  const row = (name: string, total: number) => ({ name, date: "2026-10-10", total }) as any;
  const bests = (total: number) => ({ snatch_best: 90, cj_best: total - 90, total });

  it("names athletes with new, changed or removed result rows and changed year bests", () => {
    const changed = namesWithChangedPackageData({
      results: [row("Same", 200), row("Changed", 190), row("New", 150)],
      storedResults: [row("Same", 200), row("Changed", 180), row("Removed", 170)],
      yearBests: { "Same Best": bests(200), "New Best": bests(210) },
      storedBests: { "same best": { bests: bests(200) }, "New Best": { bests: bests(205) } },
    });
    expect([...changed].sort()).toEqual(["changed", "new", "new best", "removed"]);
  });

  it("ignores a best that only left the window", () => {
    const changed = namesWithChangedPackageData({
      results: [],
      storedResults: [],
      yearBests: {},
      storedBests: { Gone: { bests: bests(200) } },
    });
    expect(changed.size).toBe(0);
  });
});
