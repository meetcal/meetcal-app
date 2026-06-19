const mockStorage = new Map<string, string>();

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStorage.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStorage.delete(key);
    }),
    multiSet: jest.fn(async (entries: [string, string][]) => {
      entries.forEach(([key, value]) => mockStorage.set(key, value));
    }),
    multiGet: jest.fn(async (keys: string[]) =>
      keys.map((key) => [key, mockStorage.get(key) ?? null]),
    ),
    multiRemove: jest.fn(async (keys: string[]) => {
      keys.forEach((key) => mockStorage.delete(key));
    }),
    getAllKeys: jest.fn(async () => Array.from(mockStorage.keys())),
  },
}));

import {
  clearMeetData,
  getAthleteLiftingResults,
  getMeetData,
  getMeetSchedule,
  getSessionAthletesFromMeetCache,
  initStore,
  saveMeetAthletes,
  saveMeetLiftingResults,
  saveMeetSchedule,
} from "@/lib/database/offline-store";

describe("offline-store athlete lifting results", () => {
  beforeEach(async () => {
    mockStorage.clear();
    await initStore();
  });

  it("matches athlete names case-insensitively with whitespace normalization", async () => {
    await saveMeetLiftingResults("Test Meet", [
      {
        id: 1,
        event_id: "evt",
        meet: "Test Meet",
        date: "2026-01-01",
        name: "  JANE   DOE ",
        age: 25,
        body_weight: 65,
        snatch1: 90,
        snatch2: 95,
        snatch3: null,
        snatch_best: 95,
        cj1: 110,
        cj2: 115,
        cj3: null,
        cj_best: 115,
        total: 210,
      },
    ] as any);

    const results = await getAthleteLiftingResults("Test Meet" as any, "jane doe");

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("  JANE   DOE ");
  });

  it("preserves cached athlete session details when saving a plain athlete payload", async () => {
    await saveMeetAthletes("Test Meet", [
      {
        memberId: "123",
        name: "Jane Doe",
        age: 25,
        club: "Club",
        gender: "Women",
        weightClass: "71kg",
        entryTotal: 200,
        adaptive: false,
        session: {
          number: 4,
          platform: "Red",
          date: "2026-06-20",
          startTime: "10:00 AM",
          weighInTime: "8:00 AM",
        },
      },
    ]);

    await saveMeetAthletes("Test Meet", [
      {
        memberId: "123",
        name: "Jane Doe",
        age: 25,
        club: "Club",
        gender: "Women",
        weightClass: "71kg",
        entryTotal: 205,
        adaptive: false,
      },
    ]);

    const meetData = await getMeetData("Test Meet" as any);
    expect(meetData.athletes[0]).toMatchObject({
      entryTotal: 205,
      session: {
        number: 4,
        platform: "Red",
      },
    });
  });

  it("hydrates schedules from the out-of-line schedule key", async () => {
    const schedule = [
      {
        date: "2026-06-20",
        fullDate: "2026-06-20",
        sessions: [
          {
            id: "Test Meet-1-Red",
            number: 1,
            startTime: "10:00 AM",
            weighInTime: "8:00 AM",
            platforms: [
              {
                platform: "Red",
                weightClass: "71kg",
                platformStartTime: "10:00 AM",
              },
            ],
          },
        ],
      },
    ] as any;

    await saveMeetSchedule("Test Meet", schedule);

    const meetData = await getMeetData("Test Meet" as any);
    expect(meetData.scheduleKey).toBe("meetcal_schedule_Test Meet");
    await expect(getMeetSchedule("Test Meet")).resolves.toEqual(schedule);
  });

  it("writes and clears session-scoped athlete caches", async () => {
    await saveMeetAthletes("Test Meet", [
      {
        memberId: "123",
        name: "Jane Doe",
        age: 25,
        club: "Club",
        gender: "Women",
        weightClass: "71kg",
        entryTotal: 200,
        adaptive: false,
        session: {
          number: 4,
          platform: "Red",
          date: "2026-06-20",
          startTime: "10:00 AM",
          weighInTime: "8:00 AM",
        },
      },
      {
        memberId: "456",
        name: "John Doe",
        age: 27,
        club: "Club",
        gender: "Men",
        weightClass: "89kg",
        entryTotal: 300,
        adaptive: false,
        session: {
          number: 5,
          platform: "Blue",
          date: "2026-06-20",
          startTime: "12:00 PM",
          weighInTime: "10:00 AM",
        },
      },
    ]);

    const redSession = await getSessionAthletesFromMeetCache(
      "Test Meet" as any,
      4,
      "Red",
    );
    expect(redSession).toHaveLength(1);
    expect(redSession[0].name).toBe("Jane Doe");

    await clearMeetData("Test Meet" as any);

    await expect(
      getSessionAthletesFromMeetCache("Test Meet" as any, 4, "Red"),
    ).resolves.toEqual([]);
  });
});
