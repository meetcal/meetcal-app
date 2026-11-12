import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearMeetData } from "@/lib/database/meet-data-clears";
import { getAllCachedLiftingResultsForAthlete } from "@/lib/database/athlete-history-store";
import { getMeetData, getMeetSchedule } from "@/lib/database/meet-data-reads";
import { getMeetAthletesSyncedAt, initStore } from "@/lib/database/offline-store-index";
import { getSessionAthletesFromMeetCache, saveSessionAthletes } from "@/lib/database/session-roster-cache";
import { markMeetScheduleVerified, saveMeetAthletes, saveMeetLiftingResults, saveMeetSchedule } from "@/lib/database/meet-data-saves";
import { itemAt } from "@/test-support/checked-access";

const mockStorage = new Map<string, string>();

let mockTrustedNow: () => Date | null = () => new Date();

jest.mock("@/lib/api/server-clock", () => ({
  getTrustedNow: () => mockTrustedNow(),
}));

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
    setMany: jest.fn(async (entries: Record<string, string>) => {
      Object.entries(entries).forEach(([key, value]) => mockStorage.set(key, value));
    }),
    getMany: jest.fn(async (keys: string[]) =>
      Object.fromEntries(keys.map((key) => [key, mockStorage.get(key) ?? null])),
    ),
    removeMany: jest.fn(async (keys: string[]) => {
      keys.forEach((key) => mockStorage.delete(key));
    }),
    getAllKeys: jest.fn(async () => Array.from(mockStorage.keys())),
  },
}));

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

    const results = await getAllCachedLiftingResultsForAthlete("jane doe");

    expect(results).toHaveLength(1);
    expect(itemAt(results, 0).name).toBe("  JANE   DOE ");
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

  it("skips rewriting the roster blob when the payload is unchanged", async () => {
    const roster = [
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
    ];

    await saveMeetAthletes("Test Meet", roster as any);

    const setItem = AsyncStorage.setItem as jest.Mock;
    const setMany = AsyncStorage.setMany as jest.Mock;
    setItem.mockClear();
    setMany.mockClear();

    await saveMeetAthletes("Test Meet", roster as any);

    expect(
      setItem.mock.calls.filter(([key]) =>
        String(key).startsWith("meetcal_athletes_"),
      ),
    ).toHaveLength(0);
    expect(setMany).not.toHaveBeenCalled();
    expect(
      setItem.mock.calls.some(([key]) => String(key) === "meetcal_offline_store"),
    ).toBe(true);

    const meetData = await getMeetData("Test Meet" as any);
    expect(meetData.athletes).toHaveLength(1);
    await expect(
      getSessionAthletesFromMeetCache("Test Meet" as any, 4, "Red"),
    ).resolves.toHaveLength(1);
  });

  it("repairs malformed cached roster rows before merging fresh athletes", async () => {
    const athlete = {
      memberId: "123", name: "Jane Doe", age: 25, club: "Club",
      gender: "Women", weightClass: "71kg", entryTotal: 200, adaptive: false,
    };
    await saveMeetAthletes("Test Meet", [athlete]);
    mockStorage.set("meetcal_athletes_Test Meet", JSON.stringify([
      null, { ...athlete, name: 123 }, athlete,
    ]));
    expect((await getMeetData("Test Meet")).athletes).toEqual([athlete]);
    await expect(saveMeetAthletes("Test Meet", [athlete])).resolves.toBe(true);
    expect(JSON.parse(mockStorage.get("meetcal_athletes_Test Meet")!)).toEqual([athlete]);
  });

  it("never replaces a stored roster with an empty one", async () => {
    const athlete = {
      memberId: "123", name: "Jane Doe", age: 25, club: "Club",
      gender: "Women", weightClass: "71kg", entryTotal: 200, adaptive: false,
      session: { number: 4, platform: "Red", date: "2099-06-20", startTime: "9:00 AM", weighInTime: "7:00 AM" },
    };
    await saveMeetAthletes("Test Meet", [athlete] as never);
    const syncedAt = (await getMeetData("Test Meet" as any)).athletesSyncedAt;
    const rosterPayload = mockStorage.get("meetcal_athletes_Test Meet");

    await expect(saveMeetAthletes("Test Meet", [])).resolves.toBe(false);

    expect(mockStorage.get("meetcal_athletes_Test Meet")).toBe(rosterPayload);
    const meetData = await getMeetData("Test Meet" as any);
    expect(meetData.athletes).toHaveLength(1);
    expect(meetData.athletesSyncedAt).toBe(syncedAt);
    await expect(
      getSessionAthletesFromMeetCache("Test Meet" as any, 4, "Red"),
    ).resolves.toHaveLength(1);
  });

  it("never writes an empty answer over a session's athletes", async () => {
    const athlete = {
      memberId: "123", name: "Jane Doe", age: 25, club: "Club",
      gender: "Women", weightClass: "71kg", entryTotal: 200, adaptive: false,
      session: { number: 4, platform: "Red" },
    };
    await saveSessionAthletes("Test Meet", 4, "Red", [athlete] as never);
    const sessionKey = Array.from(mockStorage.keys()).find((key) =>
      key.includes("session_athletes") && key.endsWith(":4:red"),
    );
    expect(sessionKey).toBeDefined();
    const payload = mockStorage.get(sessionKey!);

    await saveSessionAthletes("Test Meet", 4, "Red", []);

    expect(mockStorage.get(sessionKey!)).toBe(payload);
    await expect(
      getSessionAthletesFromMeetCache("Test Meet" as any, 4, "Red"),
    ).resolves.toHaveLength(1);
  });

  it("stores an empty roster when nothing was stored before", async () => {
    await expect(saveMeetAthletes("Empty Meet", [])).resolves.toBe(true);
    expect(mockStorage.get("meetcal_athletes_Empty Meet")).toBe("[]");
  });

  it("writes the roster blob again once the payload actually changes", async () => {
    const base = {
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
    };

    await saveMeetAthletes("Test Meet", [base] as any);

    const setMany = AsyncStorage.setMany as jest.Mock;
    setMany.mockClear();

    await saveMeetAthletes("Test Meet", [
      { ...base, entryTotal: 205 },
    ] as any);

    expect(setMany).toHaveBeenCalled();
    const meetData = await getMeetData("Test Meet" as any);
    expect(itemAt(meetData.athletes, 0).entryTotal).toBe(205);
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

  it("reads a schedule without touching the roster or writing the index", async () => {
    await saveMeetSchedule("Test Meet", [
      {
        date: "2026-06-20",
        fullDate: "2026-06-20",
        sessions: [{ id: "Test Meet-1-Red", number: 1, startTime: "", weighInTime: "", platforms: [] }],
      },
    ] as never);
    const getItem = AsyncStorage.getItem as jest.Mock;
    const setItem = AsyncStorage.setItem as jest.Mock;
    getItem.mockClear();
    setItem.mockClear();

    await expect(getMeetSchedule("Test Meet")).resolves.toHaveLength(1);
    await expect(getMeetSchedule("Never Stored")).resolves.toEqual([]);

    expect(getItem.mock.calls.map(([key]) => key)).not.toContain("meetcal_athletes_Test Meet");
    expect(setItem).not.toHaveBeenCalled();
  });

  it("does not rewrite an unchanged schedule payload", async () => {
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

    const setItem = AsyncStorage.setItem as jest.Mock;
    setItem.mockClear();
    await saveMeetSchedule("Test Meet", schedule);

    expect(
      setItem.mock.calls.filter(([key]) =>
        String(key).startsWith("meetcal_schedule_"),
      ),
    ).toHaveLength(0);
    expect(
      setItem.mock.calls.some(([key]) => String(key) === "meetcal_offline_store"),
    ).toBe(true);
    await expect(getMeetSchedule("Test Meet")).resolves.toEqual(schedule);

    const changed = [{ ...schedule[0], fullDate: "2026-06-21" }] as any;
    setItem.mockClear();
    await saveMeetSchedule("Test Meet", changed);
    expect(
      setItem.mock.calls.filter(([key]) =>
        String(key).startsWith("meetcal_schedule_"),
      ),
    ).toHaveLength(1);
    await expect(getMeetSchedule("Test Meet")).resolves.toEqual(changed);
  });

  it.each([null, "[]", "{invalid-json", "[null]", '[{"name":123,"session":{"platform":42}}]'])(
    "reads and clears session athletes with session cache %s", async (sessionPayload) => {
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

    if (sessionPayload !== null) {
      const sessionKey = Array.from(mockStorage.keys()).find((key) => key.includes("session_athletes") && key.endsWith(":4:red"));
      expect(sessionKey).toBeDefined();
      mockStorage.set(sessionKey!, sessionPayload);
    }

    const redSession = await getSessionAthletesFromMeetCache(
      "Test Meet" as any,
      4,
      "Red",
    );
    expect(redSession).toHaveLength(1);
    expect(itemAt(redSession, 0).name).toBe("Jane Doe");

    await clearMeetData("Test Meet" as any);

    await expect(
      getSessionAthletesFromMeetCache("Test Meet" as any, 4, "Red"),
    ).resolves.toEqual([]);
  });
});

describe("roster freshness stamp", () => {
  beforeEach(async () => {
    mockStorage.clear();
    await initStore();
  });

  it("is set by roster writes and left alone by schedule writes", async () => {
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000);
    await saveMeetAthletes("Test Meet", [{ name: "A", meet: "Test Meet" }] as any);
    nowSpy.mockReturnValue(9_000);
    await saveMeetSchedule("Test Meet", [
      {
        date: "2026-06-20",
        fullDate: "2026-06-20",
        sessions: [{ id: "s1", number: 1, startTime: "10:00 AM", weighInTime: "8:00 AM", platforms: [] }],
      },
    ] as any);
    nowSpy.mockRestore();

    const meetData = await getMeetData("Test Meet" as any);
    expect(meetData.lastSyncTime).toBe(9_000);
    expect(meetData.athletesSyncedAt).toBe(1_000);
    await expect(getMeetAthletesSyncedAt("Test Meet")).resolves.toBe(1_000);
    await expect(getMeetAthletesSyncedAt("Other Meet")).resolves.toBe(0);
  });
});

describe("saveMeetSchedule validation", () => {
  beforeEach(async () => {
    mockStorage.clear();
    await initStore();
  });

  it("keeps a schedule whose session has a blank or unparseable time", async () => {
    const schedule = [
      {
        date: "June 20, 2026",
        fullDate: "2026-06-20",
        sessions: [
          {
            id: "1",
            number: 1,
            startTime: "",
            weighInTime: "",
            platforms: [{ platform: "Red", weightClass: "60kg" }],
          },
          {
            id: "2",
            number: 2,
            startTime: "1:00 PM",
            weighInTime: "11:00 AM",
            platforms: [{ platform: "Blue", weightClass: "71kg" }],
          },
        ],
      },
    ] as any;

    await expect(saveMeetSchedule("Blank Time Meet", schedule)).resolves.toBeUndefined();
    await expect(getMeetSchedule("Blank Time Meet")).resolves.toEqual(schedule);
  });

  it("still rejects a session that is not addressable", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      saveMeetSchedule("Bad Meet", [
        {
          date: "June 20, 2026",
          fullDate: "2026-06-20",
          sessions: [{ id: "", number: 1, startTime: "9:00 AM", weighInTime: "7:00 AM", platforms: [] }],
        },
      ] as any),
    ).rejects.toThrow("Invalid session structure");
    await expect(
      saveMeetSchedule("Bad Meet", [
        {
          date: "June 20, 2026",
          fullDate: "2026-06-20",
          sessions: [{ id: "1", number: 1, startTime: "9:00 AM", weighInTime: "7:00 AM", platforms: "Red" }],
        },
      ] as any),
    ).rejects.toThrow("Invalid session structure");
    error.mockRestore();
  });
});

describe("schedule sync stamp (#397)", () => {
  const SCHEDULE = [
    {
      date: "June 20, 2026",
      fullDate: "2026-06-20",
      sessions: [
        { id: "1", number: 1, startTime: "9:00 AM", weighInTime: "7:00 AM", platforms: [{ platform: "Red", weightClass: "60kg" }] },
      ],
    },
  ] as any;

  beforeEach(async () => {
    mockStorage.clear();
    await initStore();
  });

  it("restamps a checked, unchanged schedule only once the stamp is old enough", async () => {
    await saveMeetSchedule("Stamp Meet", SCHEDULE);
    const savedAt = (await getMeetData("Stamp Meet" as never)).lastSyncTime;

    await expect(markMeetScheduleVerified("Stamp Meet", savedAt + 60_000, 15 * 60_000)).resolves.toBe(false);
    expect((await getMeetData("Stamp Meet" as never)).lastSyncTime).toBe(savedAt);

    await expect(markMeetScheduleVerified("Stamp Meet", savedAt + 15 * 60_000, 15 * 60_000)).resolves.toBe(true);
    expect((await getMeetData("Stamp Meet" as never)).lastSyncTime).toBe(savedAt + 15 * 60_000);
  });

  it("does not rewind a newer stamp a save wrote while the check waited", async () => {
    await saveMeetSchedule("Stamp Meet", SCHEDULE);
    const index = JSON.parse(mockStorage.get("meetcal_offline_store")!);
    const savedAt: number = index.meets["Stamp Meet"].lastSyncTime;
    const stale = JSON.parse(JSON.stringify(index));
    stale.meets["Stamp Meet"].lastSyncTime = savedAt - 60 * 60_000;
    jest.mocked(AsyncStorage.getItem).mockImplementationOnce(async () => JSON.stringify(stale));

    await expect(markMeetScheduleVerified("Stamp Meet", savedAt - 1, 15 * 60_000)).resolves.toBe(false);
    expect((await getMeetData("Stamp Meet" as never)).lastSyncTime).toBe(savedAt);
  });

  it("does not create an entry for a meet with nothing stored", async () => {
    await expect(markMeetScheduleVerified("Unknown Meet")).resolves.toBe(false);
    expect(JSON.parse(mockStorage.get("meetcal_offline_store") ?? "{}").meets?.["Unknown Meet"]).toBeUndefined();
  });

  it("reads the schedule without the roster", async () => {
    await saveMeetSchedule("Stamp Meet", SCHEDULE);
    const getItem = jest.mocked(AsyncStorage.getItem);
    getItem.mockClear();
    await expect(getMeetSchedule("Stamp Meet")).resolves.toEqual(SCHEDULE);
    const keys = getItem.mock.calls.map(([key]) => key);
    expect(keys.some((key) => /athlete/i.test(String(key)))).toBe(false);
  });
});
