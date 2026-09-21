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

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearMeetData,
  getAllCachedLiftingResultsForAthlete,
  getAllCachedLiftingResultsForAthletes,
  getAthleteLiftingResults,
  getExplicitlyDownloadedMeetIds,
  getMeetData,
  getMeetLiftingResults,
  getMeetSchedule,
  getSessionAthletesFromMeetCache,
  initStore,
  markMeetExplicitlyDownloaded,
  saveAthleteHistory,
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

describe("offline-store corrupt payload handling", () => {
  beforeEach(async () => {
    mockStorage.clear();
    await initStore();
  });

  it("degrades to no cached results when a chunk payload decodes to a non-array", async () => {
    await saveMeetLiftingResults("Test Meet", [
      {
        id: 1,
        event_id: "evt",
        meet: "Test Meet",
        date: "2026-01-01",
        name: "Jane Doe",
        age: 25,
        body_weight: 65,
        snatch1: 90,
        snatch2: null,
        snatch3: null,
        snatch_best: 90,
        cj1: 110,
        cj2: null,
        cj3: null,
        cj_best: 110,
        total: 200,
      } as any,
    ]);

    // Overwrite chunk 0 with a payload that inflates to a valid but non-array
    // JSON document. Before the narrowing this reached callers as an object
    // and blew up on `.filter`.
    const chunkKey = Array.from(mockStorage.keys()).find((key) =>
      key.includes("__chunk_0"),
    )!;
    mockStorage.set(chunkKey, "not base64 deflate");

    await expect(getMeetLiftingResults("Test Meet")).resolves.toEqual([]);
  });

  it("survives a truncated store payload when clearing a meet", async () => {
    mockStorage.set("meetcal_offline_store", "{\"meets\":");

    await expect(clearMeetData("Test Meet" as any)).resolves.toBeUndefined();
  });
});

describe("explicit meet downloads", () => {
  beforeEach(async () => {
    mockStorage.clear();
    await initStore();
  });

  it("returns an empty set when nothing has been downloaded", async () => {
    await expect(getExplicitlyDownloadedMeetIds()).resolves.toEqual(new Set());
  });

  it("reports every downloaded meet from a single read", async () => {
    await markMeetExplicitlyDownloaded("Meet A" as any, true);
    await markMeetExplicitlyDownloaded("Meet B" as any, true);
    await markMeetExplicitlyDownloaded("Meet B" as any, false);

    await expect(getExplicitlyDownloadedMeetIds()).resolves.toEqual(
      new Set(["Meet A"]),
    );
  });
});

describe("getAllCachedLiftingResultsForAthletes", () => {
  const row = (overrides: Record<string, unknown>) =>
    ({
      id: 1,
      event_id: "evt",
      meet: "Meet A",
      date: "2026-01-01",
      name: "Jane Doe",
      age: 25,
      body_weight: 65,
      snatch1: 90,
      snatch2: null,
      snatch3: null,
      snatch_best: 90,
      cj1: 110,
      cj2: null,
      cj3: null,
      cj_best: 110,
      total: 200,
      ...overrides,
    }) as any;

  beforeEach(async () => {
    mockStorage.clear();
    jest.clearAllMocks();
    await initStore();
  });

  it("aggregates a name across every cached meet, newest date first", async () => {
    await saveMeetLiftingResults("Meet A", [
      row({ event_id: "a", meet: "Meet A", date: "2025-03-01" }),
      row({ event_id: "a", meet: "Meet A", date: "2025-03-01", name: "Other Person" }),
    ]);
    await saveMeetLiftingResults("Meet B", [
      row({ event_id: "b", meet: "Meet B", date: "2026-05-01" }),
    ]);

    const byName = await getAllCachedLiftingResultsForAthletes(["Jane Doe"]);

    expect(byName["Jane Doe"].map((r) => r.date)).toEqual([
      "2026-05-01",
      "2025-03-01",
    ]);
  });

  it("matches names case-insensitively and with whitespace normalization", async () => {
    await saveMeetLiftingResults("Meet A", [
      row({ event_id: "a", name: "  JANE   DOE " }),
      row({ event_id: "a", name: "jane doe" }),
    ]);

    const byName = await getAllCachedLiftingResultsForAthletes(["Jane Doe"]);

    // Both rows belong to the athlete. They are not duplicates of each other:
    // the dedupe key carries the raw name, so the two spellings stay distinct.
    expect(byName["Jane Doe"]).toHaveLength(2);
  });

  it("de-duplicates the same row cached under two meets", async () => {
    const shared = row({ event_id: "shared", meet: "Meet A", date: "2025-03-01" });
    await saveMeetLiftingResults("Meet A", [shared]);
    await saveMeetLiftingResults("Meet B", [shared]);

    const byName = await getAllCachedLiftingResultsForAthletes(["Jane Doe"]);

    expect(byName["Jane Doe"]).toHaveLength(1);
  });

  it("prefers the athlete's own history blob over the meet scan", async () => {
    await saveMeetLiftingResults("Meet A", [row({ date: "2020-01-01" })]);
    await saveAthleteHistory("Jane Doe", [
      row({ event_id: "hist", meet: "History Meet", date: "2026-09-01" }),
    ]);

    const byName = await getAllCachedLiftingResultsForAthletes(["Jane Doe"]);

    expect(byName["Jane Doe"]).toHaveLength(1);
    expect(byName["Jane Doe"][0].meet).toBe("History Meet");
  });

  it("returns the same rows as the single-athlete helper", async () => {
    await saveMeetLiftingResults("Meet A", [
      row({ event_id: "a", date: "2025-03-01" }),
    ]);
    await saveMeetLiftingResults("Meet B", [
      row({ event_id: "b", meet: "Meet B", date: "2026-05-01" }),
      row({ event_id: "b", meet: "Meet B", name: "John Doe" }),
    ]);

    const batch = await getAllCachedLiftingResultsForAthletes([
      "Jane Doe",
      "John Doe",
      "Nobody At All",
    ]);

    await expect(
      getAllCachedLiftingResultsForAthlete("Jane Doe"),
    ).resolves.toEqual(batch["Jane Doe"]);
    await expect(
      getAllCachedLiftingResultsForAthlete("John Doe"),
    ).resolves.toEqual(batch["John Doe"]);
    expect(batch["Nobody At All"]).toEqual([]);
  });

  // The whole point of the batch: meets are the outer loop, so each meet's
  // compressed results blob is read and inflated once no matter how many
  // athletes are asked for.
  it("reads each meet's results blob once for the whole batch", async () => {
    await saveMeetLiftingResults("Meet A", [
      row({ event_id: "a", name: "Jane Doe" }),
      row({ event_id: "a", name: "John Doe" }),
      row({ event_id: "a", name: "Jo Doe" }),
    ]);
    await saveMeetLiftingResults("Meet B", [
      row({ event_id: "b", meet: "Meet B", name: "Jane Doe" }),
    ]);

    jest.clearAllMocks();
    await getAllCachedLiftingResultsForAthletes([
      "Jane Doe",
      "John Doe",
      "Jo Doe",
    ]);

    const manifestReads = (AsyncStorage.getItem as jest.Mock).mock.calls.filter(
      ([key]: [string]) =>
        typeof key === "string" &&
        key.startsWith("meetcal_lifting_results_") &&
        !key.includes("__chunk_"),
    );
    expect(manifestReads).toHaveLength(2);
  });

  it("returns an empty record for an empty name list without touching storage", async () => {
    jest.clearAllMocks();
    await expect(getAllCachedLiftingResultsForAthletes([])).resolves.toEqual({});
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });
});
