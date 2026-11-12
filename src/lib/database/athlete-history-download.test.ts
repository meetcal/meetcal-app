import AsyncStorage from "@react-native-async-storage/async-storage";
import { prefetchMeetData } from "@/lib/database/meet-manager";
import { HISTORY_DEFERRED_RETRY_DELAY_MS, HISTORY_RETRY_AFTER_DEFAULT_MS, HISTORY_RETRY_AFTER_MAX_MS, historyRetryDelayMs } from "@/lib/database/athlete-history-download";
import { itemAt } from "@/test-support/checked-access";

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

const mockSaveMeetAthletes = jest.fn(async (): Promise<boolean> => true);

const mockFindAthleteNamesWithoutHistory = jest.fn(
  async (_names: readonly string[]): Promise<string[]> => [],
);

let mockIsExplicitlyDownloaded: (meet: string) => boolean = () => true;

const mockGetMeetLiftingResults = jest.fn(async (_meet: string): Promise<any[]> => []);

const mockClearMeetData = jest.fn(
  async (_meet: string): Promise<void> => undefined,
);

const mockGetMeetAthletesSyncedAt = jest.fn(async (_meet: string): Promise<number> => 0);

jest.mock("@/lib/database/queries", () => ({
  fetchSchedule: (...args: unknown[]) => mockFetchSchedule(...args),
  fetchAthletesWithSession: (...args: unknown[]) =>
    mockFetchAthletesWithSession(...args),
}));

jest.mock("@/lib/api/meet-package-api", () => ({
  ...jest.requireActual("@/lib/api/meet-package-api"),
  fetchApiMeetPackageConditional: (...args: unknown[]) =>
    mockFetchApiMeetPackageConditional(
      ...(args as [string, string | undefined, string | null | undefined]),
    ),
}));

jest.mock("@/lib/api/results-api", () => ({
  ...jest.requireActual("@/lib/api/results-api"),
  fetchApiResultsByNames: (...args: unknown[]) =>
    mockFetchApiResultsByNames(...(args as [string[]])),
}));

jest.mock("@/lib/api/meets-api", () => ({
  ...jest.requireActual("@/lib/api/meets-api"),
  fetchApiMeets: () => mockFetchApiMeets(),
}));

jest.mock("@/lib/database/meet-data-clears", () => ({
  clearImplicitMeetData: (...args: unknown[]) =>
    mockClearImplicitMeetData(...(args as [string | undefined])),
  clearMeetData: (...args: unknown[]) => mockClearMeetData.apply(null, args),
}));

jest.mock("@/lib/database/athlete-history-clears", () => ({
  pruneOrphanedAthleteHistory: (...args: unknown[]) =>
    mockPruneOrphanedAthleteHistory(...(args as [{ keepNames?: readonly string[] } | undefined])),
}));

jest.mock("@/lib/database/meet-data-reads", () => ({
  getMeetData: jest.fn(async () => ({
    schedule: null,
    scheduleKey: "",
    athletesKey: "",
    athletes: [],
    liftingResultsKey: "",
    lastSyncTime: 0,
  })),
  getMeetLiftingResults: (meet: string) => mockGetMeetLiftingResults(meet),
}));

jest.mock("@/lib/database/meet-downloads-registry", () => ({
  isMeetExplicitlyDownloaded: async (meet: string) =>
    mockIsExplicitlyDownloaded(meet),
  getExplicitlyDownloadedMeetIds: async () => ({
    has: (meet: string) => mockIsExplicitlyDownloaded(meet),
  }),
}));

jest.mock("@/lib/database/offline-store-index", () => ({
  getMeetAthletesSyncedAt: (meet: string) => mockGetMeetAthletesSyncedAt(meet),
}));

jest.mock("@/lib/database/athlete-history-store", () => ({
  saveAthleteHistoryBatch: (entries: readonly { name: string; results: unknown[] }[]) =>
    mockSaveAthleteHistoryBatch(entries),
  findAthleteNamesWithoutHistory: (names: readonly string[]) =>
    mockFindAthleteNamesWithoutHistory(names),
}));

jest.mock("@/lib/database/athlete-bests-store", () => ({
  saveAthleteBestsBatch: jest.fn(async () => undefined),
}));

jest.mock("@/lib/database/meet-data-saves", () => ({
  saveMeetAthletes: (...args: unknown[]) =>
    mockSaveMeetAthletes.apply(null, args),
  saveMeetLiftingResults: jest.fn(async () => undefined),
  saveMeetSchedule: (...args: unknown[]) =>
    mockSaveMeetSchedule.apply(null, args),
}));


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

    expect(mockSaveAthleteHistory).toHaveBeenCalledWith("Athlete A", [
      { name: "Athlete A", date: "2025-06-01" },
      { name: "Athlete A", date: "2014-06-01" },
    ]);
    expect(mockSaveAthleteHistory).toHaveBeenCalledWith("Athlete B", [
      { name: "Athlete B", date: "2010-06-01" },
    ]);
    expect(mockSaveAthleteHistory).toHaveBeenCalledWith("Athlete C", []);
  });

  it("files result rows in another Unicode form under the roster's name (#268)", async () => {
    const nfc = "José Núñez".normalize("NFC");
    const nfd = nfc.normalize("NFD");
    mockFetchApiMeetPackage.mockResolvedValue({
      meet: {},
      schedule: [],
      athletes: [buildAthlete(nfd)],
      meet_results: [],
      recent_results_by_name: {},
      year_bests_by_name: {},
    });
    mockFetchApiResultsByNames.mockResolvedValue([
      { name: nfc, date: "2025-06-01" },
      { name: nfc, date: "2024-06-01" },
    ]);

    await prefetchMeetData("History Meet NFC" as any);

    expect(mockSaveAthleteHistory).toHaveBeenCalledTimes(1);
    expect(mockSaveAthleteHistory).toHaveBeenCalledWith(nfd, [
      { name: nfc, date: "2025-06-01" },
      { name: nfc, date: "2024-06-01" },
    ]);
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

    expect(mockFetchApiResultsByNames).toHaveBeenCalledTimes(2);
    expect(itemAt(mockFetchApiResultsByNames.mock.calls, 0)[0]).toHaveLength(40);
    expect(itemAt(mockFetchApiResultsByNames.mock.calls, 1)[0]).toHaveLength(10);
    expect(mockSaveAthleteHistory).toHaveBeenCalledTimes(50);
    expect(mockSaveAthleteHistoryBatch).toHaveBeenCalledTimes(2);
    expect(itemAt(mockSaveAthleteHistoryBatch.mock.calls, 0)[0]).toHaveLength(40);
    expect(itemAt(mockSaveAthleteHistoryBatch.mock.calls, 1)[0]).toHaveLength(10);
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
      await jest.advanceTimersByTimeAsync(0);
      expect(mockFetchApiResultsByNames).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(999);
      expect(mockFetchApiResultsByNames).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(1);
      await expect(prefetch).resolves.toBeUndefined();

      expect(mockFetchApiResultsByNames).toHaveBeenCalledTimes(4);
      expect(itemAt(mockFetchApiResultsByNames.mock.calls, 1)[0]).toEqual(
        itemAt(mockFetchApiResultsByNames.mock.calls, 2)[0],
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
      expect(mockFetchApiResultsByNames).toHaveBeenCalledTimes(3);
      await jest.advanceTimersByTimeAsync(HISTORY_DEFERRED_RETRY_DELAY_MS);
      await expect(prefetch).resolves.toBeUndefined();

      expect(mockFetchApiResultsByNames).toHaveBeenCalledTimes(4);
      expect(itemAt(mockFetchApiResultsByNames.mock.calls, 3)[0]).toEqual(
        itemAt(mockFetchApiResultsByNames.mock.calls, 1)[0],
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
    mockSaveAthleteHistory.mockRejectedValueOnce(new Error("SQLITE_FULL"));

    await expect(prefetchMeetData("History Meet C" as any)).rejects.toThrow(
      /athlete_history/,
    );
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
