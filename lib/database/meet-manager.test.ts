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
const mockSaveMeetSchedule = jest.fn(async () => undefined);
const mockSaveMeetAthletes = jest.fn(async () => undefined);
const mockSaveSessionAthletes = jest.fn(async () => undefined);

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
  };
});

jest.mock("@/lib/database/offline-store", () => ({
  clearImplicitMeetData: jest.fn(async () => undefined),
  clearMeetData: jest.fn(async () => undefined),
  getMeetData: jest.fn(async () => ({
    schedule: null,
    scheduleKey: "",
    athletesKey: "",
    athletes: [],
    liftingResultsKey: "",
    lastSyncTime: 0,
  })),
  saveAthleteHistory: jest.fn(async () => undefined),
  saveAthleteBestsBatch: jest.fn(async () => undefined),
  saveMeetAthletes: (...args: unknown[]) =>
    mockSaveMeetAthletes.apply(null, args),
  saveMeetLiftingResults: jest.fn(async () => undefined),
  saveMeetSchedule: (...args: unknown[]) =>
    mockSaveMeetSchedule.apply(null, args),
  saveSessionAthletes: (...args: unknown[]) =>
    mockSaveSessionAthletes.apply(null, args),
}));

import {
  prefetchCriticalMeetData,
  validatePrefetchedLiftingResults,
  warmMeetData,
} from "@/lib/database/meet-manager";
import type { Schedule } from "@/types/schedule";

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

  it("defers full meet package prefetch until after critical session caches", async () => {
    jest.useFakeTimers();
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
});
