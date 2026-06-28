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
const mockFetchApiResultsByNames = jest.fn(async (_names: string[]) => []);
const mockSaveAthleteHistory = jest.fn(async () => undefined);
const mockSaveMeetSchedule = jest.fn(async () => undefined);
const mockSaveMeetAthletes = jest.fn(async () => undefined);
const mockSaveSessionAthletes = jest.fn(async () => undefined);
const mockIsMeetExplicitlyDownloaded = jest.fn(
  async (_meet: string): Promise<boolean> => true,
);
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
    fetchApiMeetPackage: (...args: unknown[]) =>
      mockFetchApiMeetPackage(...args),
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
  isMeetExplicitlyDownloaded: (...args: unknown[]) =>
    mockIsMeetExplicitlyDownloaded.apply(null, args),
  saveAthleteHistory: (...args: unknown[]) =>
    mockSaveAthleteHistory.apply(null, args),
  saveAthleteBestsBatch: jest.fn(async () => undefined),
  saveMeetAthletes: (...args: unknown[]) =>
    mockSaveMeetAthletes.apply(null, args),
  saveMeetLiftingResults: jest.fn(async () => undefined),
  saveMeetSchedule: (...args: unknown[]) =>
    mockSaveMeetSchedule.apply(null, args),
  saveSessionAthletes: (...args: unknown[]) =>
    mockSaveSessionAthletes.apply(null, args),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  prefetchCriticalMeetData,
  prefetchMeetData,
  validatePrefetchedLiftingResults,
  warmMeetData,
} from "@/lib/database/meet-manager";
import type { Schedule } from "@/types/schedule";

const mockGetItem = AsyncStorage.getItem as jest.Mock;

describe("validatePrefetchedLiftingResults", () => {
  it("throws when athletes exist but lifting results are empty", () => {
    expect(() =>
      validatePrefetchedLiftingResults(
        "Test Meet" as any,
        ["Athlete A"],
        [],
      ),
    ).toThrow("No lifting results fetched for meet: Test Meet");
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
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchAthletesWithSession.mockImplementation(
      async (_meet: string, sessionNumber?: number, platform?: string) =>
        sessionNumber && platform
          ? [{ name: `${sessionNumber}-${platform}`, session: { number: sessionNumber, platform } }]
          : [],
    );
    mockFetchApiMeetPackage.mockResolvedValue({
      meet: {},
      schedule: [],
      athletes: [],
      meet_results: [],
      recent_results_by_name: {},
      year_bests_by_name: {},
    });
  });

  it("warms first visible session athlete caches while full athlete warmup runs", async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockFetchSchedule).toHaveBeenCalledWith("Test Meet");
    expect(mockFetchAthletesWithSession).toHaveBeenCalledWith("Test Meet");
    expect(mockSaveMeetSchedule).toHaveBeenCalledWith("Test Meet", schedule);
    expect(mockSaveMeetAthletes).toHaveBeenCalledWith("Test Meet", []);

    const filteredCalls = mockFetchAthletesWithSession.mock.calls.filter(
      ([, sessionNumber, platform]) => sessionNumber != null && platform != null,
    );
    expect(filteredCalls).toHaveLength(8);
    expect(filteredCalls.slice(0, 3)).toEqual([
      ["Test Meet", 1, "Red"],
      ["Test Meet", 1, "White"],
      ["Test Meet", 1, "Blue"],
    ]);
    expect(mockSaveSessionAthletes).toHaveBeenCalledTimes(8);
  });

  it("prioritizes current and future meet days before backfilling earlier days in reverse", async () => {
    const schedule: Schedule = [-3, -2, -1, 0, 1, 2].map((dayOffset, index) => ({
      date: `Day ${index + 1}`,
      fullDate: isoDateOffset(dayOffset),
      sessions: [
        {
          id: `session-${index + 1}`,
          number: index + 1,
          startTime: "8:00 AM",
          weighInTime: "6:00 AM",
          platforms: [
            { platform: "Red", weightClass: `Day ${index + 1}` },
          ],
        },
      ],
    }));
    mockFetchSchedule.mockResolvedValue(schedule);

    await prefetchCriticalMeetData("Test Meet" as any);

    const filteredCalls = mockFetchAthletesWithSession.mock.calls.filter(
      ([, sessionNumber, platform]) => sessionNumber != null && platform != null,
    );
    expect(filteredCalls).toEqual([
      ["Test Meet", 4, "Red"],
      ["Test Meet", 5, "Red"],
      ["Test Meet", 6, "Red"],
      ["Test Meet", 3, "Red"],
      ["Test Meet", 2, "Red"],
      ["Test Meet", 1, "Red"],
    ]);
  });

  it("waits for each priority day batch before loading the next day", async () => {
    const schedule: Schedule = [0, 1, 2].map((dayOffset, index) => ({
      date: `Day ${index + 1}`,
      fullDate: isoDateOffset(dayOffset),
      sessions: [
        {
          id: `session-${index + 1}`,
          number: index + 1,
          startTime: "8:00 AM",
          weighInTime: "6:00 AM",
          platforms: [
            { platform: "Red", weightClass: `Day ${index + 1}` },
          ],
        },
      ],
    }));
    mockFetchSchedule.mockResolvedValue(schedule);
    let resolveFirstDay: (() => void) | undefined;
    mockFetchAthletesWithSession.mockImplementation(
      async (_meet: string, sessionNumber?: number, platform?: string) => {
        if (!sessionNumber || !platform) return [];
        if (sessionNumber === 1) {
          await new Promise<void>((resolve) => {
            resolveFirstDay = resolve;
          });
        }
        return [{ name: `${sessionNumber}-${platform}`, session: { number: sessionNumber, platform } }];
      },
    );

    const prefetch = prefetchCriticalMeetData("Test Meet" as any);
    await new Promise((resolve) => setImmediate(resolve));

    let filteredCalls = mockFetchAthletesWithSession.mock.calls.filter(
      ([, sessionNumber, platform]) => sessionNumber != null && platform != null,
    );
    expect(filteredCalls).toEqual([["Test Meet", 1, "Red"]]);

    resolveFirstDay?.();
    await prefetch;

    filteredCalls = mockFetchAthletesWithSession.mock.calls.filter(
      ([, sessionNumber, platform]) => sessionNumber != null && platform != null,
    );
    expect(filteredCalls).toEqual([
      ["Test Meet", 1, "Red"],
      ["Test Meet", 2, "Red"],
      ["Test Meet", 3, "Red"],
    ]);
  });

  it("defers full meet package prefetch for explicitly downloaded meets", async () => {
    jest.useFakeTimers();
    mockIsMeetExplicitlyDownloaded.mockResolvedValue(true);
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

      expect(mockSaveSessionAthletes).toHaveBeenCalledWith(
        "Test Meet",
        1,
        "Red",
        [{ name: "1-Red", session: { number: 1, platform: "Red" } }],
      );
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
    mockIsMeetExplicitlyDownloaded.mockResolvedValue(false);
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

      // Critical session caches still warm, but the heavy history package never runs.
      expect(mockSaveSessionAthletes).toHaveBeenCalledWith(
        "Test Meet",
        1,
        "Red",
        [{ name: "1-Red", session: { number: 1, platform: "Red" } }],
      );

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
    const athleteNames = Array.from({ length: 30 }, (_, i) => `Athlete ${i + 1}`);
    mockFetchApiMeetPackage.mockResolvedValue({
      meet: {},
      schedule: [],
      athletes: athleteNames.map(buildAthlete),
      meet_results: [{ name: "Athlete 1" }],
      recent_results_by_name: {},
      year_bests_by_name: {},
    });

    await prefetchMeetData("History Meet B" as any);

    // 30 athletes / batch size 25 => 2 batches.
    expect(mockFetchApiResultsByNames).toHaveBeenCalledTimes(2);
    expect(mockFetchApiResultsByNames.mock.calls[0][0]).toHaveLength(25);
    expect(mockFetchApiResultsByNames.mock.calls[1][0]).toHaveLength(5);
    expect(mockSaveAthleteHistory).toHaveBeenCalledTimes(30);
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
    mockIsMeetExplicitlyDownloaded.mockImplementation(
      async (meet: string) => meet === "Downloaded Meet",
    );

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
