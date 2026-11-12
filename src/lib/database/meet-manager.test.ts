import AsyncStorage from "@react-native-async-storage/async-storage";
import { prefetchCriticalMeetData, prefetchMeetData, ROSTER_PREFETCH_AFTER_FIRST_SCREEN_MS, ROSTER_PREFETCH_MAX_DEFER_MS, warmMeetData } from "@/lib/database/meet-manager";
import { HISTORY_DEFERRED_RETRY_DELAY_MS } from "@/lib/database/athlete-history-download";
import { HISTORY_REFRESH_TTL_MS } from "@/lib/database/history-download-state";
import { PrefetchCancelledError } from "@/lib/database/prefetch-requests";
import { runHistoryClear, runMeetClear } from "@/lib/database/offline-clears";
import type { Schedule } from "@/types/schedule";
import { mapApiLiftingResult } from "@/lib/api/api-athlete-mappers";
import { itemAt } from "@/test-support/checked-access";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
    setMany: jest.fn(async () => undefined),
    getMany: jest.fn(async () => ({})),
    removeMany: jest.fn(async () => undefined),
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

const setExplicitlyDownloaded = (predicate: (meet: string) => boolean) => {
  mockIsExplicitlyDownloaded = predicate;
};

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

const mockGetItem = AsyncStorage.getItem as jest.Mock;

const beginMeetClear = (meet: string) => runMeetClear(meet, async () => {});

const beginHistoryClear = () => runHistoryClear(async () => {});

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

  it("does not start the deferred prefetch for a meet un-marked before it fires", async () => {
    jest.useFakeTimers();
    setExplicitlyDownloaded(() => true);
    mockFetchSchedule.mockResolvedValue([]);

    try {
      await warmMeetData("Removed Meet" as any);
      setExplicitlyDownloaded(() => false);

      await jest.advanceTimersByTimeAsync(5000);
      expect(mockFetchApiMeetPackage).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  describe("the launch's deferred roster", () => {
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
            platforms: [{ platform: "Red", weightClass: "Red class" }],
          },
        ],
      },
    ];

    function gate() {
      let open!: () => void;
      const promise = new Promise<void>((resolve) => {
        open = resolve;
      });
      return { promise, open };
    }

    beforeEach(() => {
      jest.useFakeTimers();
      setExplicitlyDownloaded(() => false);
      mockFetchSchedule.mockResolvedValue(schedule);
      mockGetMeetAthletesSyncedAt.mockResolvedValue(0);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("warms the schedule at once and the roster only after the first screen", async () => {
      const firstScreen = gate();
      let done = false;
      const warming = warmMeetData("Launch Meet" as any, { rosterAfter: firstScreen.promise }).then(() => {
        done = true;
      });

      await jest.advanceTimersByTimeAsync(0);
      expect(mockSaveMeetSchedule).toHaveBeenCalledWith("Launch Meet", schedule);
      expect(mockFetchAthletesWithSession).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1000);
      firstScreen.open();
      await jest.advanceTimersByTimeAsync(ROSTER_PREFETCH_AFTER_FIRST_SCREEN_MS - 1);
      expect(mockFetchAthletesWithSession).not.toHaveBeenCalled();
      expect(done).toBe(false);

      await jest.advanceTimersByTimeAsync(1);
      await warming;
      expect(mockFetchAthletesWithSession).toHaveBeenCalledWith("Launch Meet");
      expect(mockSaveMeetAthletes).toHaveBeenCalledWith("Launch Meet", roster);
      expect(jest.getTimerCount()).toBe(0);
    });

    it("fetches the roster at the cap when the first screen never settles", async () => {
      const never = new Promise<void>(() => {});
      const warming = warmMeetData("Stuck Meet" as any, { rosterAfter: never });

      await jest.advanceTimersByTimeAsync(ROSTER_PREFETCH_MAX_DEFER_MS - 1);
      expect(mockFetchAthletesWithSession).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      await warming;
      expect(mockFetchAthletesWithSession).toHaveBeenCalledWith("Stuck Meet");
      expect(jest.getTimerCount()).toBe(0);
    });

    it("waits only the settle delay once the first screen is already up (a later automatic switch)", async () => {
      const warming = warmMeetData("Later Meet" as any, { rosterAfter: Promise.resolve() });
      await jest.advanceTimersByTimeAsync(ROSTER_PREFETCH_AFTER_FIRST_SCREEN_MS);
      await warming;
      expect(mockFetchAthletesWithSession).toHaveBeenCalledWith("Later Meet");
    });

    it("lets a caller that wants the meet now (a forced sync) skip the wait", async () => {
      const firstScreen = gate();
      const deferredWarm = warmMeetData("Synced Meet" as any, { rosterAfter: firstScreen.promise });
      await jest.advanceTimersByTimeAsync(0);
      expect(mockFetchAthletesWithSession).not.toHaveBeenCalled();

      const forced = prefetchCriticalMeetData("Synced Meet" as any);
      await jest.advanceTimersByTimeAsync(0);
      await forced;
      await deferredWarm;
      expect(mockFetchAthletesWithSession).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    });

    it("does not download a roster the Start List stored while it waited", async () => {
      const firstScreen = gate();
      const warming = warmMeetData("Start List Meet" as any, { rosterAfter: firstScreen.promise });
      await jest.advanceTimersByTimeAsync(0);
      mockGetMeetAthletesSyncedAt.mockResolvedValue(Date.now());

      firstScreen.open();
      await jest.advanceTimersByTimeAsync(ROSTER_PREFETCH_AFTER_FIRST_SCREEN_MS);
      await warming;
      expect(mockFetchAthletesWithSession).not.toHaveBeenCalled();
      expect(mockSaveMeetSchedule).toHaveBeenCalledTimes(1);
    });

    it("does not write back a roster cleared while it waited or downloaded", async () => {
      const firstScreen = gate();
      const warming = warmMeetData("Cleared Meet" as any, { rosterAfter: firstScreen.promise });
      await jest.advanceTimersByTimeAsync(0);
      let answer!: (rows: unknown) => void;
      mockFetchAthletesWithSession.mockImplementationOnce(
        () => new Promise((resolve) => {
          answer = resolve;
        }),
      );

      firstScreen.open();
      await jest.advanceTimersByTimeAsync(ROSTER_PREFETCH_AFTER_FIRST_SCREEN_MS);
      expect(mockFetchAthletesWithSession).toHaveBeenCalledWith("Cleared Meet");
      await beginMeetClear("Cleared Meet");
      answer(roster);
      await warming;
      expect(mockSaveMeetAthletes).not.toHaveBeenCalled();

      mockFetchAthletesWithSession.mockClear();
      const nextScreen = gate();
      const next = warmMeetData("Cleared Early" as any, { rosterAfter: nextScreen.promise });
      await jest.advanceTimersByTimeAsync(0);
      await beginMeetClear("Cleared Early");
      nextScreen.open();
      await jest.advanceTimersByTimeAsync(ROSTER_PREFETCH_AFTER_FIRST_SCREEN_MS);
      await next;
      expect(mockFetchAthletesWithSession).not.toHaveBeenCalled();
      expect(mockSaveMeetAthletes).not.toHaveBeenCalled();
    });

    it("clears its timers when offline, where the roster step never runs", async () => {
      const { isNetworkAvailable } = jest.requireMock("@/lib/networkUtils") as {
        isNetworkAvailable: jest.Mock;
      };
      isNetworkAvailable.mockResolvedValueOnce(false);
      await warmMeetData("Offline Meet" as any, { rosterAfter: new Promise<void>(() => {}) });
      expect(mockFetchSchedule).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });
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

      expect(mockSaveMeetAthletes).toHaveBeenCalledWith("Test Meet", roster);

      await jest.advanceTimersByTimeAsync(10000);
      expect(mockFetchApiMeetPackage).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("package revalidation with ETag", () => {
  const PACKAGE_ETAG_KEY = "@meet_package_etag_v1";
  const meetDataReads = jest.requireMock("@/lib/database/meet-data-reads");
  const mockGetMeetData = meetDataReads.getMeetData as jest.Mock;
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
    expect(itemAt(mockFetchApiMeetPackageConditional.mock.calls, 0)[2]).toBe('"abc"');
    expect(mockSaveMeetAthletes).not.toHaveBeenCalled();
    expect(mockSaveMeetSchedule).not.toHaveBeenCalled();
    expect(mockFetchApiResultsByNames).not.toHaveBeenCalled();
    expect(mockSaveAthleteHistory).not.toHaveBeenCalled();
  });

  it("still downloads history for roster athletes whose blob is missing on a 304", async () => {
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

    expect(mockFindAthleteNamesWithoutHistory).toHaveBeenCalledWith(["Athlete A", "Athlete B"]);
    expect(mockFetchApiResultsByNames).not.toHaveBeenCalled();
    expect(mockSaveAthleteHistoryBatch).not.toHaveBeenCalled();
  });

  it("re-downloads every athlete's history on a 304 when a refresh forces it, however fresh", async () => {
    storedEtags({ "Etag Meet Forced": '"abc"' });
    mockGetMeetData.mockResolvedValue({
      ...emptyMeetData,
      athletes: [{ name: "Athlete A" }, { name: "Athlete B" }],
    });
    mockFetchApiMeetPackageConditional.mockResolvedValueOnce({ status: "not_modified" });

    await prefetchMeetData("Etag Meet Forced" as any, { forceHistoryRefresh: true });

    expect(itemAt(mockFetchApiMeetPackageConditional.mock.calls, 0)[2]).toBe('"abc"');
    expect(mockFindAthleteNamesWithoutHistory).not.toHaveBeenCalled();
    expect(mockFetchApiResultsByNames).toHaveBeenCalledWith(["Athlete A", "Athlete B"]);
    expect(mockSaveMeetAthletes).not.toHaveBeenCalled();
    expect(mockSaveMeetSchedule).not.toHaveBeenCalled();
  });

  const untilCalled = async (mock: jest.Mock, times: number) => {
    for (let i = 0; i < 50 && mock.mock.calls.length < times; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(mock).toHaveBeenCalledTimes(times);
  };

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

  it("resumes an unfinished history refresh with only the athletes it did not reach", async () => {
    const pendingSince = Date.now() - 60_000;
    mockGetItem.mockImplementation(async (key: string) => {
      if (key === PACKAGE_ETAG_KEY) return JSON.stringify({ "Etag Meet Resume": '"abc"' });
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

    expect(mockFetchApiResultsByNames).toHaveBeenCalledTimes(1);
    expect(mockFetchApiResultsByNames).toHaveBeenCalledWith(["athlete  c", "Athlete B"]);
    expect(mockSaveMeetAthletes).not.toHaveBeenCalled();
    const stampWrites = mockSetItem.mock.calls.filter(([key]) => key === "@meet_history_synced_at_v1");
    expect(stampWrites).toHaveLength(1);
    const pendingWrites = mockSetItem.mock.calls
      .filter(([key]) => key === "@meet_history_pending_v1")
      .map(([, value]) => JSON.parse(value as string));
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

    expect(savedEtags().at(-1)).toEqual({});
  });

  it("resumes an unfinished refresh together with a changed package's athletes", async () => {
    mockGetItem.mockImplementation(async (key: string) => {
      if (key === PACKAGE_ETAG_KEY) return JSON.stringify({ "Etag Meet Changed": '"old"' });
      if (key === "@meet_history_pending_v1") {
        return JSON.stringify({
          "Etag Meet Changed": { names: ["Athlete B"], since: Date.now() - 60_000 },
        });
      }
      if (key === "@meet_package_year_bests_v1") return JSON.stringify({ "Etag Meet Changed": {} });
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

  it("fetches only the athletes whose results or year bests changed when a known package changes", async () => {
    mockGetItem.mockImplementation(async (key: string) => {
      if (key === PACKAGE_ETAG_KEY) return JSON.stringify({ "Etag Meet Live": '"old"' });
      if (key === "@meet_history_synced_at_v1") {
        return JSON.stringify({ "Etag Meet Live": Date.now() - 60_000 });
      }
      if (key === "@meet_package_year_bests_v1") {
        return JSON.stringify({ "Etag Meet Live": { "athlete c": [90, 110, 200] } });
      }
      return null;
    });
    const unchanged = { name: "Athlete A", date: "2026-10-10", total: 200 };
    mockGetMeetLiftingResults.mockResolvedValueOnce([mapApiLiftingResult(unchanged as any)]);
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
    expect([...itemAt(mockFetchApiResultsByNames.mock.calls, 0)[0]].sort()).toEqual([
      "Athlete B",
      "Athlete D",
    ]);
    const stampWrites = mockSetItem.mock.calls.filter(([key]) => key === "@meet_history_synced_at_v1");
    expect(stampWrites).toHaveLength(0);
    const { saveMeetLiftingResults } = jest.requireMock("@/lib/database/meet-data-saves");
    const firstPending = mockSetItem.mock.calls.findIndex(([key]) => key === "@meet_history_pending_v1");
    expect(firstPending).toBeGreaterThanOrEqual(0);
    expect(JSON.parse(mockSetItem.mock.calls[firstPending][1] as string)["Etag Meet Live"]).toMatchObject({
      names: expect.arrayContaining(["athlete b", "athlete d"]),
      full: false,
    });
    expect(mockSetItem.mock.invocationCallOrder[firstPending]).toBeLessThan(
      itemAt((saveMeetLiftingResults as jest.Mock).mock.invocationCallOrder, 0),
    );
    const snapshots = mockSetItem.mock.calls.filter(([key]) => key === "@meet_package_year_bests_v1");
    expect(JSON.parse(snapshots[snapshots.length - 1][1] as string)).toEqual({
      "Etag Meet Live": { "athlete c": [90, 110, 200], "athlete d": [70, 90, 160] },
    });
  });

  it("compares a changed package's bests with the last ingested package, not the shared store", async () => {
    mockGetItem.mockImplementation(async (key: string) => {
      if (key === PACKAGE_ETAG_KEY) return JSON.stringify({ "Etag Meet Ada": '"old"' });
      if (key === "@meet_history_synced_at_v1") {
        return JSON.stringify({ "Etag Meet Ada": Date.now() - 60_000 });
      }
      if (key === "@meet_package_year_bests_v1") {
        return JSON.stringify({ "Etag Meet Ada": { ada: [40, 50, 90] } });
      }
      return null;
    });
    mockFetchApiMeetPackageConditional.mockResolvedValueOnce({
      status: "fresh",
      etag: '"new"',
      package: {
        ...freshPackage,
        athletes: ["Ada", "Bea"].map(athlete),
        meet_results: [],
        year_bests_by_name: { Ada: { best_snatch: 42, best_cj: 53, best_total: 95 } },
      },
    });

    await prefetchMeetData("Etag Meet Ada" as any);

    expect(mockFetchApiResultsByNames).toHaveBeenCalledWith(["Ada"]);
  });

  it("refreshes the whole roster for a changed package with no recorded bests to compare", async () => {
    mockGetItem.mockImplementation(async (key: string) => {
      if (key === PACKAGE_ETAG_KEY) return JSON.stringify({ "Etag Meet New Code": '"old"' });
      if (key === "@meet_history_synced_at_v1") {
        return JSON.stringify({ "Etag Meet New Code": Date.now() - 60_000 });
      }
      return null;
    });
    mockFetchApiMeetPackageConditional.mockResolvedValueOnce({
      status: "fresh",
      etag: '"new"',
      package: { ...freshPackage, athletes: ["Ada", "Bea"].map(athlete), meet_results: [] },
    });

    await prefetchMeetData("Etag Meet New Code" as any);

    expect(mockFetchApiResultsByNames).toHaveBeenCalledWith(["Ada", "Bea"]);
  });

  it("stores only the package's real year bests, not its zero rows", async () => {
    const saveBests = jest.requireMock("@/lib/database/athlete-bests-store").saveAthleteBestsBatch as jest.Mock;
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
    expect(itemAt(mockFetchApiMeetPackageConditional.mock.calls, 0)[2]).toBe('"abc"');
    expect(itemAt(mockFetchApiMeetPackageConditional.mock.calls, 1)[2]).toBeNull();
    expect(mockSaveMeetAthletes).toHaveBeenCalledTimes(1);
    expect(savedEtags()[0]).toEqual({});
  });

  it("persists the ETag only after a fully successful prefetch", async () => {
    mockFetchApiMeetPackageConditional.mockResolvedValueOnce({
      status: "fresh",
      etag: '"fresh-tag"',
      package: freshPackage,
    });

    await prefetchMeetData("Etag Meet C" as any);

    expect(itemAt(mockFetchApiMeetPackageConditional.mock.calls, 0)[2]).toBeNull();
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
    expect(pendingWrites[pendingWrites.length - 1]).toEqual({
      "Etag Meet D": { names: ["Athlete A"], since: expect.any(Number) },
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

describe("downloads and the clears that remove their data", () => {
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
  const packageOf = (count: number) => ({
    meet: {},
    schedule: [],
    athletes: Array.from({ length: count }, (_, i) => athlete(`Athlete ${i + 1}`)),
    meet_results: [],
    recent_results_by_name: {},
    year_bests_by_name: {},
  });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const until = async (done: () => boolean) => {
    for (let i = 0; i < 100 && !done(); i += 1) await tick();
    expect(done()).toBe(true);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchApiResultsByNames.mockResolvedValue([]);
    setExplicitlyDownloaded(() => true);
  });

  it("stops the history pass at the next batch once the meet is cleared, and the clear waits for it", async () => {
    mockFetchApiMeetPackage.mockResolvedValue(packageOf(50));
    let answerFirstBatch!: (rows: unknown[]) => void;
    mockFetchApiResultsByNames.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerFirstBatch = resolve as (rows: unknown[]) => void;
        }),
    );

    const download = prefetchMeetData("Cleared Meet" as any);
    const outcome = download.catch((error: unknown) => error);
    await until(() => mockFetchApiResultsByNames.mock.calls.length === 1);

    let clearProceeded = false;
    const clearing = beginMeetClear("Cleared Meet").then(() => {
      clearProceeded = true;
    });
    await tick();
    expect(clearProceeded).toBe(false);

    answerFirstBatch([{ name: "Athlete 1", date: "2025-01-01" }]);
    await clearing;

    await expect(outcome).resolves.toBeInstanceOf(PrefetchCancelledError);
    expect(mockSaveAthleteHistoryBatch).not.toHaveBeenCalled();
    expect(mockFetchApiResultsByNames).toHaveBeenCalledTimes(1);
  });

  it("never joins a download that started before the meet was last cleared", async () => {
    mockFetchApiMeetPackage.mockResolvedValue(packageOf(1));
    let answerOld!: (value: unknown) => void;
    mockFetchApiMeetPackageConditional.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerOld = resolve as (value: unknown) => void;
        }),
    );

    const old = prefetchMeetData("Rejoined Meet" as any);
    const oldOutcome = old.catch((error: unknown) => error);
    await until(() => mockFetchApiMeetPackageConditional.mock.calls.length === 1);

    const clearing = beginHistoryClear();
    const fresh = prefetchMeetData("Rejoined Meet" as any);
    expect(fresh).not.toBe(old);

    answerOld({ status: "fresh", etag: null, package: packageOf(1) });
    await clearing;
    await expect(oldOutcome).resolves.toBeInstanceOf(PrefetchCancelledError);
    await expect(fresh).resolves.toBeUndefined();
    expect(mockFetchApiMeetPackageConditional).toHaveBeenCalledTimes(2);
    expect(mockSaveMeetAthletes).toHaveBeenCalledTimes(1);
  });

  it("waits for a clear of the meet that is still running before it starts", async () => {
    mockFetchApiMeetPackage.mockResolvedValue(packageOf(1));
    let finishClear!: () => void;
    const clearing = runMeetClear(
      "Clearing Meet",
      () =>
        new Promise<void>((resolve) => {
          finishClear = resolve;
        }),
    );
    await tick();

    const download = prefetchMeetData("Clearing Meet" as any);
    await tick();
    expect(mockFetchApiMeetPackageConditional).not.toHaveBeenCalled();

    finishClear();
    await clearing;
    await download;
    expect(mockFetchApiMeetPackageConditional).toHaveBeenCalledTimes(1);
  });

  it("waits for a clear that started while it waited for a superseded download", async () => {
    mockFetchApiMeetPackage.mockResolvedValue(packageOf(1));
    let answerOld!: (value: unknown) => void;
    mockFetchApiMeetPackageConditional.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerOld = resolve as (value: unknown) => void;
        }),
    );
    const old = prefetchMeetData("Forced Meet" as any).catch((error: unknown) => error);
    await until(() => mockFetchApiMeetPackageConditional.mock.calls.length === 1);
    const forced = prefetchMeetData("Forced Meet" as any, { forceHistoryRefresh: true });
    await tick();

    let finishClear!: () => void;
    const clearing = runMeetClear(
      "Forced Meet",
      () =>
        new Promise<void>((resolve) => {
          finishClear = resolve;
        }),
    );
    answerOld({ status: "fresh", etag: null, package: packageOf(1) });
    await expect(old).resolves.toBeInstanceOf(PrefetchCancelledError);
    await until(() => typeof finishClear === "function");
    await tick();
    expect(mockFetchApiMeetPackageConditional).toHaveBeenCalledTimes(1);

    finishClear();
    await clearing;
    await forced;
    expect(mockFetchApiMeetPackageConditional).toHaveBeenCalledTimes(2);
  });

  it("does not start the deferred prefetch for a meet a running clear un-marks", async () => {
    jest.useFakeTimers();
    let downloaded = true;
    setExplicitlyDownloaded(() => downloaded);
    mockFetchSchedule.mockResolvedValue([]);
    try {
      await warmMeetData("Warm Removed" as any);
      let finishClear!: () => void;
      const clearing = runMeetClear(
        "Warm Removed",
        () =>
          new Promise<void>((resolve) => {
            finishClear = resolve;
          }),
      );
      await jest.advanceTimersByTimeAsync(5000);
      downloaded = false;
      finishClear();
      await clearing;
      await jest.advanceTimersByTimeAsync(0);
      expect(mockFetchApiMeetPackageConditional).not.toHaveBeenCalled();
      expect(mockFetchApiMeetPackage).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("still joins a download that started after the last clear", async () => {
    await beginMeetClear("Joined Meet");
    mockFetchApiMeetPackage.mockResolvedValue(packageOf(1));

    const first = prefetchMeetData("Joined Meet" as any);
    const second = prefetchMeetData("Joined Meet" as any);
    await Promise.all([first, second]);

    expect(mockFetchApiMeetPackageConditional).toHaveBeenCalledTimes(1);
  });

  it("keeps downloads still running when the out-of-space recovery clears the browse cache", async () => {
    let answerOther!: (value: unknown) => void;
    mockFetchApiMeetPackageConditional
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerOther = resolve as (value: unknown) => void;
          }),
      )
      .mockResolvedValueOnce({ status: "fresh", etag: '"a"', package: packageOf(1) })
      .mockResolvedValueOnce({ status: "fresh", etag: '"b"', package: packageOf(1) });
    const other = prefetchMeetData("Still Downloading" as any);
    await until(() => mockFetchApiMeetPackageConditional.mock.calls.length === 1);
    mockSaveMeetAthletes.mockRejectedValueOnce(new Error("SQLITE_FULL"));

    await prefetchMeetData("Out Of Space" as any);

    expect(mockClearImplicitMeetData).toHaveBeenCalledTimes(1);
    const [except, options] = mockClearImplicitMeetData.mock.calls[0] as unknown as [
      string,
      { skip: (meet: string) => boolean },
    ];
    expect(except).toBe("Out Of Space");
    expect(options.skip("Still Downloading")).toBe(true);
    expect(options.skip("Only Browsed")).toBe(false);

    answerOther({ status: "fresh", etag: null, package: packageOf(1) });
    await other;
  });
});
