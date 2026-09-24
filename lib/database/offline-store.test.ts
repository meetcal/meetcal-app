import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearAllAthleteHistory,
  clearAllMeetData,
  clearExpiredDownloadedMeets,
  clearImplicitMeetData,
  clearMeetData,
  findAthleteNamesWithoutHistory,
  PACKAGE_ETAG_STORAGE_KEY,
  getAllCachedLiftingResultsForAthlete,
  getAllCachedLiftingResultsForAthletes,
  getCachedAthleteBestsForNames,
  getAthleteLiftingResults,
  getExplicitlyDownloadedMeetIds,
  getMeetData,
  getMeetLiftingResults,
  getMeetSchedule,
  getSessionAthletesFromMeetCache,
  initStore,
  markMeetExplicitlyDownloaded,
  pruneOrphanedAthleteHistory,
  saveAthleteBestsBatch,
  saveAthleteHistory,
  saveAthleteHistoryBatch,
  saveMeetAthletes,
  saveMeetLiftingResults,
  saveMeetSchedule,
} from "@/lib/database/offline-store";

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
    const multiSet = AsyncStorage.multiSet as jest.Mock;
    setItem.mockClear();
    multiSet.mockClear();

    await saveMeetAthletes("Test Meet", roster as any);

    // Neither the roster key nor any session-scoped key is rewritten.
    expect(
      setItem.mock.calls.filter(([key]) =>
        String(key).startsWith("meetcal_athletes_"),
      ),
    ).toHaveLength(0);
    expect(multiSet).not.toHaveBeenCalled();
    // The small store-metadata write still happens so lastSyncTime advances.
    expect(
      setItem.mock.calls.some(([key]) => String(key) === "meetcal_offline_store"),
    ).toBe(true);

    // The cached data is still readable and correct.
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
    await expect(saveMeetAthletes("Test Meet", [athlete])).resolves.toBeUndefined();
    expect(JSON.parse(mockStorage.get("meetcal_athletes_Test Meet")!)).toEqual([athlete]);
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

    const multiSet = AsyncStorage.multiSet as jest.Mock;
    multiSet.mockClear();

    await saveMeetAthletes("Test Meet", [
      { ...base, entryTotal: 205 },
    ] as any);

    expect(multiSet).toHaveBeenCalled();
    const meetData = await getMeetData("Test Meet" as any);
    expect(meetData.athletes[0].entryTotal).toBe(205);
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
    // lastSyncTime still advances.
    expect(
      setItem.mock.calls.some(([key]) => String(key) === "meetcal_offline_store"),
    ).toBe(true);
    await expect(getMeetSchedule("Test Meet")).resolves.toEqual(schedule);

    // A genuine change is still persisted.
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
    expect(redSession[0].name).toBe("Jane Doe");

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

  // `getMeetSchedule` now returns `getMeetData`'s already-parsed schedule
  // instead of re-reading and re-parsing the same key. These pin the three
  // degraded payloads where the two readers had to agree for that to be safe.
  it.each([
    ["invalid JSON", "{\"not\": "],
    ["valid JSON that is not an array", "{\"sessions\":[]}"],
    ["an empty payload", ""],
  ])("reads no cached schedule when the payload is %s", async (_label, payload) => {
    await saveMeetSchedule("Test Meet", [
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
    ] as never);
    mockStorage.set("meetcal_schedule_Test Meet", payload);

    await expect(getMeetSchedule("Test Meet")).resolves.toEqual([]);
    await expect(
      getMeetData("Test Meet" as never).then((data) => data.schedule),
    ).resolves.toBeNull();
  });

  it("reads no cached schedule when the meet was never stored", async () => {
    await expect(getMeetSchedule("Unknown Meet")).resolves.toEqual([]);
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

describe("clearAllAthleteHistory", () => {
  beforeEach(async () => {
    mockStorage.clear();
    await initStore();
  });

  const row = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 1,
      event_id: "evt",
      meet: "Meet A",
      date: "2025-01-01",
      name: "Jane Doe",
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
      ...overrides,
    }) as any;

  it("removes every athlete history key without a read per athlete", async () => {
    const names = Array.from({ length: 12 }, (_, i) => `Athlete ${i}`);
    for (const name of names) {
      await saveAthleteHistory(name, [row({ name })]);
    }

    jest.clearAllMocks();
    await clearAllAthleteHistory();

    // One key listing, no per-athlete manifest reads.
    expect(AsyncStorage.getAllKeys).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
    expect(AsyncStorage.multiRemove).toHaveBeenCalledTimes(1);

    const leftovers = (await AsyncStorage.getAllKeys()).filter((k) =>
      k.startsWith("meetcal_athlete_history_"),
    );
    expect(leftovers).toEqual([]);
  });

  it("reaps chunk keys orphaned by an interrupted write", async () => {
    await saveAthleteHistory("Jane Doe", [row()]);
    mockStorage.set("meetcal_athlete_history_jane doe__chunk_7", "orphan");
    mockStorage.delete("meetcal_athlete_history_jane doe");

    await clearAllAthleteHistory();

    expect(
      (await AsyncStorage.getAllKeys()).filter((k) =>
        k.startsWith("meetcal_athlete_history_"),
      ),
    ).toEqual([]);
  });

  it("leaves meet-scoped lifting results alone", async () => {
    await saveMeetLiftingResults("Meet A", [row()]);
    await saveAthleteHistory("Jane Doe", [row()]);

    await clearAllAthleteHistory();

    expect(
      (await AsyncStorage.getAllKeys()).some((k) =>
        k.startsWith("meetcal_lifting_results_"),
      ),
    ).toBe(true);
  });

  it("drops the package validators that vouched for the deleted history", async () => {
    // With the validators left behind, the next prefetch's 304 would find the
    // roster still on disk and never re-download a single athlete.
    mockStorage.set(PACKAGE_ETAG_STORAGE_KEY, JSON.stringify({ "Meet A": '"abc"' }));
    await saveAthleteHistory("Jane Doe", [row()]);

    await clearAllAthleteHistory();

    expect(mockStorage.has(PACKAGE_ETAG_STORAGE_KEY)).toBe(false);
  });

  it("reports which athletes have no history blob, reading manifests only", async () => {
    await saveAthleteHistory("Jane Doe", [row()]);
    jest.clearAllMocks();

    await expect(
      findAthleteNamesWithoutHistory(["Jane Doe", "  jane   DOE ", "John Smith", ""]),
    ).resolves.toEqual(["John Smith"]);
    // One batched read; no chunk inflation.
    expect(AsyncStorage.multiGet).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
    await expect(findAthleteNamesWithoutHistory([])).resolves.toEqual([]);
  });
});

describe("cached lifting result row validation", () => {
  beforeEach(async () => {
    mockStorage.clear();
    await initStore();
  });

  it("drops corrupt rows from a cached results payload instead of throwing", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const good = { id: 1, event_id: "evt", meet: "Meet A", date: "2025-01-01", name: "Jane Doe" };
    await saveMeetLiftingResults("Meet A", [good, null, 42, "nope", { date: "2025-01-01" }] as any);

    await expect(getMeetLiftingResults("Meet A")).resolves.toEqual([good]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Dropped 4 malformed"));
    warn.mockRestore();
  });

  it("treats an empty event_id as no id when de-duplicating across meets", async () => {
    // `??` kept `''` and collapsed every id-less row into one `-date-name`
    // key, so two different meets on the same day dropped one another.
    await saveMeetLiftingResults("Meet A", [
      { id: 1, event_id: "", meet: "Meet A", date: "2025-01-01", name: "Jane Doe" } as any,
    ]);
    await saveMeetLiftingResults("Meet B", [
      { id: 2, event_id: "", meet: "Meet B", date: "2025-01-01", name: "Jane Doe" } as any,
    ]);

    const results = await getAllCachedLiftingResultsForAthlete("Jane Doe");
    expect(results.map((r) => r.meet).sort()).toEqual(["Meet A", "Meet B"]);
  });
});

describe("offline store metadata validation", () => {
  const STORE_KEY = "meetcal_offline_store";

  beforeEach(() => {
    mockStorage.clear();
  });

  it("drops corrupt meet entries and repairs missing keys instead of throwing", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockStorage.set(
      STORE_KEY,
      JSON.stringify({
        meets: {
          "Good Meet": {
            scheduleKey: "meetcal_schedule_Good Meet",
            athletesKey: "meetcal_athletes_Good Meet",
            liftingResultsKey: "meetcal_lifting_results_Good Meet",
            lastSyncTime: 5,
          },
          "Bare Meet": {},
          "Null Meet": null,
          "String Meet": "nope",
          "Array Meet": [],
        },
      }),
    );

    await expect(getMeetSchedule("Good Meet")).resolves.toEqual([]);
    // The validated store is written back on the next store write; asking
    // for an unknown meet is the cheapest one.
    await getMeetData("New Meet");
    const stored = JSON.parse(mockStorage.get(STORE_KEY) ?? "{}");
    expect(Object.keys(stored.meets).sort()).toEqual(["Bare Meet", "Good Meet", "New Meet"]);
    expect(stored.meets["Good Meet"].lastSyncTime).toBe(5);
    // A present-but-empty entry is rebuilt from the meet id.
    expect(stored.meets["Bare Meet"]).toMatchObject({
      scheduleKey: "meetcal_schedule_Bare Meet",
      athletesKey: "meetcal_athletes_Bare Meet",
      liftingResultsKey: "meetcal_lifting_results_Bare Meet",
      lastSyncTime: 0,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Dropped 3 malformed"));
    warn.mockRestore();
  });

  it("reinitializes when `meets` is not an object", async () => {
    mockStorage.set(STORE_KEY, JSON.stringify({ meets: [] }));
    await expect(getMeetSchedule("Any Meet")).resolves.toEqual([]);
    expect(JSON.parse(mockStorage.get(STORE_KEY) ?? "{}")).toMatchObject({ meets: {} });
  });
});

describe("saveMeetSchedule validation", () => {
  beforeEach(async () => {
    mockStorage.clear();
    await initStore();
  });

  it("keeps a schedule whose session has a blank or unparseable time", async () => {
    // `formatApiTime` maps a null or malformed API time to "", a documented
    // normal state. Rejecting the whole schedule for it rendered "No schedule
    // yet" for every session in the meet.
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

describe("clearing several meets", () => {
  beforeEach(async () => {
    mockStorage.clear();
    await initStore();
  });

  async function seedMeet(meet: string) {
    await saveMeetAthletes(meet, [
      {
        memberId: `${meet}-1`,
        name: `Athlete ${meet}`,
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
          startTime: "12:00 PM",
          weighInTime: "10:00 AM",
        },
      },
    ] as never);
  }

  it("lists storage keys once for the whole batch, not once per meet", async () => {
    const meets = ["Meet A", "Meet B", "Meet C", "Meet D"];
    for (const meet of meets) {
      await seedMeet(meet);
    }
    jest.clearAllMocks();

    await clearAllMeetData();

    // `clearMeetData` has to enumerate every storage key to find a meet's
    // session-athlete entries. One listing answers the question for all four.
    expect(AsyncStorage.getAllKeys).toHaveBeenCalledTimes(1);
  });

  it("still removes every meet's session-athlete keys", async () => {
    const meets = ["Meet A", "Meet B", "Meet C"];
    for (const meet of meets) {
      await seedMeet(meet);
    }
    expect(
      Array.from(mockStorage.keys()).filter((k) =>
        k.startsWith("meetcal_session_athletes_"),
      ),
    ).toHaveLength(3);

    await clearAllMeetData();

    expect(
      Array.from(mockStorage.keys()).filter((k) =>
        k.startsWith("meetcal_session_athletes_"),
      ),
    ).toEqual([]);
    for (const meet of meets) {
      await expect(getMeetData(meet as never)).resolves.toMatchObject({
        athletes: [],
        schedule: null,
      });
    }
  });

  it("does not list storage keys when nothing has expired", async () => {
    await seedMeet("Meet A");
    // Ends far in the future, so the expiry sweep has no work to do. This runs
    // on every meets refresh — app start, every five minutes, on reconnect.
    await markMeetExplicitlyDownloaded("Meet A" as never, true, {
      endDate: "2099-06-20",
    });
    jest.clearAllMocks();

    await clearExpiredDownloadedMeets();

    expect(AsyncStorage.getAllKeys).not.toHaveBeenCalled();
    expect(mockStorage.has("meetcal_athletes_Meet A")).toBe(true);
  });
});

describe("clearImplicitMeetData", () => {
  beforeEach(async () => {
    mockStorage.clear();
    await initStore();
  });

  const athlete = (meet: string) => ({
    memberId: `${meet}-1`,
    name: `Athlete ${meet}`,
    age: 25,
    club: "Club",
    gender: "Women",
    weightClass: "71kg",
    entryTotal: 200,
    adaptive: false,
  });

  it("clears only meets the user did not download, and never the one being opened", async () => {
    for (const meet of ["Downloaded", "Browsed", "Opening"]) {
      await saveMeetAthletes(meet, [athlete(meet)] as never);
    }
    await markMeetExplicitlyDownloaded("Downloaded" as never, true, { endDate: "2099-06-20" });

    await clearImplicitMeetData("Opening" as never);

    await expect(getMeetData("Downloaded" as never)).resolves.toMatchObject({
      athletes: [expect.objectContaining({ name: "Athlete Downloaded" })],
    });
    await expect(getMeetData("Opening" as never)).resolves.toMatchObject({
      athletes: [expect.objectContaining({ name: "Athlete Opening" })],
    });
    await expect(getMeetData("Browsed" as never)).resolves.toMatchObject({ athletes: [] });
  });
});

describe("cached athlete bests", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  it("round-trips bests under the normalized name and skips blank names", async () => {
    await saveAthleteBestsBatch({
      "  Jane   Doe ": { snatch_best: 90, cj_best: 110, total: 200 },
      "   ": { snatch_best: 1, cj_best: 1, total: 2 },
    });

    expect(AsyncStorage.multiSet).toHaveBeenLastCalledWith([
      [expect.stringContaining("jane doe"), expect.any(String)],
    ]);
    await expect(getCachedAthleteBestsForNames(["jane doe", "Nobody"])).resolves.toEqual({
      "jane doe": { snatch_best: 90, cj_best: 110, total: 200 },
    });
  });

  it("reads corrupt or mistyped blobs as missing or null, never as numbers", async () => {
    await saveAthleteBestsBatch({ "Jane Doe": { snatch_best: 90, cj_best: 110, total: 200 } });
    const key = Array.from(mockStorage.keys()).find((k) => k.includes("jane doe"))!;

    mockStorage.set(key, "{truncated");
    await expect(getCachedAthleteBestsForNames(["Jane Doe"])).resolves.toEqual({ "Jane Doe": undefined });

    mockStorage.set(key, JSON.stringify({ snatch_best: "90", cj_best: null, total: 200 }));
    await expect(getCachedAthleteBestsForNames(["Jane Doe"])).resolves.toEqual({
      "Jane Doe": { snatch_best: null, cj_best: null, total: 200 },
    });
  });

  it("writes a roster-sized bests map in bounded multiSet batches", async () => {
    const multiSet = AsyncStorage.multiSet as jest.Mock;
    multiSet.mockClear();
    const bests = Object.fromEntries(
      Array.from({ length: 1201 }, (_, i) => [
        `Athlete ${i}`,
        { snatch_best: 90, cj_best: 110, total: 200 },
      ]),
    );

    await saveAthleteBestsBatch(bests);

    expect(multiSet.mock.calls.map(([entries]) => entries.length)).toEqual([500, 500, 201]);
    await expect(getCachedAthleteBestsForNames(["Athlete 1200"])).resolves.toEqual({
      "Athlete 1200": { snatch_best: 90, cj_best: 110, total: 200 },
    });
  });

  it("does not write at all for an empty map", async () => {
    const multiSet = AsyncStorage.multiSet as jest.Mock;
    multiSet.mockClear();
    await saveAthleteBestsBatch({});
    expect(multiSet).not.toHaveBeenCalled();
  });

  it("returns an empty record when storage is unavailable", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    (AsyncStorage.multiGet as jest.Mock).mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(getCachedAthleteBestsForNames(["Jane Doe"])).resolves.toEqual({});
  });
});

describe("lifting results manifest bounds", () => {
  const HISTORY_KEY = "meetcal_athlete_history_jane doe";

  beforeEach(() => {
    mockStorage.clear();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ["an absurd chunk count", 1e9],
    ["an infinite chunk count", "Infinity"],
    ["a fractional chunk count", 1.5],
    ["a negative chunk count", -3],
  ])("reads %s as no cached history without allocating per chunk", async (_label, chunks) => {
    const multiGet = AsyncStorage.multiGet as jest.Mock;
    multiGet.mockClear();
    mockStorage.set(
      HISTORY_KEY,
      // JSON cannot spell Infinity; `1e400` parses to it.
      `{"format":"deflate-base64-chunks-v1","chunks":${chunks === "Infinity" ? "1e400" : chunks}}`,
    );

    await expect(getAllCachedLiftingResultsForAthlete("Jane Doe")).resolves.toEqual([]);
    const chunkReads = multiGet.mock.calls.filter(([keys]) =>
      (keys as string[]).some((key) => key.includes("__chunk_")),
    );
    expect(chunkReads).toHaveLength(0);
  });

  it("replaces a corrupt manifest without iterating its chunk count", async () => {
    const multiRemove = AsyncStorage.multiRemove as jest.Mock;
    multiRemove.mockClear();
    mockStorage.set(HISTORY_KEY, '{"format":"deflate-base64-chunks-v1","chunks":1000000000}');

    await saveAthleteHistory("Jane Doe", [
      { name: "Jane Doe", meet: "M", date: "2026-01-01", total: 200 } as never,
    ]);

    expect(multiRemove).not.toHaveBeenCalled();
    await expect(getAllCachedLiftingResultsForAthlete("Jane Doe")).resolves.toEqual([
      expect.objectContaining({ name: "Jane Doe", total: 200 }),
    ]);
  });
});

describe("batched athlete history writes", () => {
  const HISTORY_PREFIX = "meetcal_athlete_history_";
  const row = (name: string, date: string, total = 200) =>
    ({ id: 1, event_id: "evt", meet: "Meet A", date, name, total }) as any;
  const entries = (count: number, date = "2025-01-01") =>
    Array.from({ length: count }, (_, i) => ({
      name: `Athlete ${i + 1}`,
      results: [row(`Athlete ${i + 1}`, date)],
    }));
  const writeCalls = () => ({
    multiSet: (AsyncStorage.multiSet as jest.Mock).mock.calls.length,
    multiRemove: (AsyncStorage.multiRemove as jest.Mock).mock.calls.length,
    setItem: (AsyncStorage.setItem as jest.Mock).mock.calls.length,
    removeItem: (AsyncStorage.removeItem as jest.Mock).mock.calls.length,
  });
  const historyKeys = () =>
    Array.from(mockStorage.keys()).filter((k) => k.startsWith(HISTORY_PREFIX)).sort();

  beforeEach(async () => {
    mockStorage.clear();
    await initStore();
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("writes a 40-athlete batch with one multiSet, no setItem and no per-athlete remove", async () => {
    // Before: 40 athletes cost 40 manifest getItems, 40 chunk setItems, 40
    // verify getItems and 40 manifest setItems = 80 writes, each an iOS
    // manifest.json rewrite. After: one multiSet.
    await expect(saveAthleteHistoryBatch(entries(40))).resolves.toBe(40);

    expect(writeCalls()).toEqual({ multiSet: 1, multiRemove: 0, setItem: 0, removeItem: 0 });
    expect(historyKeys()).toHaveLength(80);
    await expect(getAllCachedLiftingResultsForAthlete("Athlete 40")).resolves.toEqual([
      expect.objectContaining({ name: "Athlete 40", date: "2025-01-01" }),
    ]);
  });

  it("writes nothing at all when the batch is byte-identical to what is stored", async () => {
    await saveAthleteHistoryBatch(entries(40));
    jest.clearAllMocks();

    // The TTL refresh re-downloads unchanged history; it must not rewrite it.
    await expect(saveAthleteHistoryBatch(entries(40))).resolves.toBe(0);

    expect(writeCalls()).toEqual({ multiSet: 0, multiRemove: 0, setItem: 0, removeItem: 0 });
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });

  it("rewrites only the athletes whose history changed, in one multiSet and one multiRemove", async () => {
    await saveAthleteHistoryBatch(entries(40));
    jest.clearAllMocks();

    const changed = entries(40);
    changed[4] = { name: "Athlete 5", results: [row("Athlete 5", "2026-02-01")] };
    changed[9] = { name: "Athlete 10", results: [row("Athlete 10", "2026-02-01")] };
    await expect(saveAthleteHistoryBatch(changed)).resolves.toBe(2);

    expect(writeCalls()).toEqual({ multiSet: 1, multiRemove: 1, setItem: 0, removeItem: 0 });
    const [pairs] = (AsyncStorage.multiSet as jest.Mock).mock.calls[0];
    // 2 chunks + 2 manifests, chunks before manifests.
    expect(pairs.map(([key]: [string, string]) => key)).toEqual([
      `${HISTORY_PREFIX}athlete 5__chunk_0_g1`,
      `${HISTORY_PREFIX}athlete 10__chunk_0_g1`,
      `${HISTORY_PREFIX}athlete 5`,
      `${HISTORY_PREFIX}athlete 10`,
    ]);
    // The previous generation's chunks are gone, nothing else was touched.
    expect((AsyncStorage.multiRemove as jest.Mock).mock.calls[0][0]).toEqual([
      `${HISTORY_PREFIX}athlete 5__chunk_0`,
      `${HISTORY_PREFIX}athlete 10__chunk_0`,
    ]);
    expect(historyKeys()).toHaveLength(80);
    await expect(getAllCachedLiftingResultsForAthlete("Athlete 5")).resolves.toEqual([
      expect.objectContaining({ date: "2026-02-01" }),
    ]);
    await expect(getAllCachedLiftingResultsForAthlete("Athlete 6")).resolves.toEqual([
      expect.objectContaining({ date: "2025-01-01" }),
    ]);
  });

  it("removes the old chunks only after the new manifest is written", async () => {
    await saveAthleteHistory("Jane Doe", [row("Jane Doe", "2025-01-01")]);
    jest.clearAllMocks();

    await saveAthleteHistory("Jane Doe", [row("Jane Doe", "2026-01-01")]);

    const multiSetOrder = (AsyncStorage.multiSet as jest.Mock).mock.invocationCallOrder[0];
    const multiRemoveOrder = (AsyncStorage.multiRemove as jest.Mock).mock.invocationCallOrder[0];
    expect(multiSetOrder).toBeLessThan(multiRemoveOrder);
    const manifest = JSON.parse(mockStorage.get(`${HISTORY_PREFIX}jane doe`) ?? "null");
    expect(manifest).toEqual({ format: "deflate-base64-chunks-v1", chunks: 1, generation: 1 });
    expect(historyKeys()).toEqual([
      `${HISTORY_PREFIX}jane doe`,
      `${HISTORY_PREFIX}jane doe__chunk_0_g1`,
    ]);
  });

  it("keeps the previous copy readable when the batch write is rejected", async () => {
    await saveAthleteHistoryBatch(entries(3));
    const before = new Map(mockStorage);
    jest.clearAllMocks();
    (AsyncStorage.multiSet as jest.Mock).mockRejectedValueOnce(new Error("SQLITE_FULL"));

    await expect(saveAthleteHistoryBatch(entries(3, "2026-06-01"))).rejects.toThrow("SQLITE_FULL");

    // The old manifests point at the old chunks, which were never removed.
    for (const [key, value] of before) {
      expect(mockStorage.get(key)).toBe(value);
    }
    expect(AsyncStorage.multiRemove).not.toHaveBeenCalled();
    for (const name of ["Athlete 1", "Athlete 2", "Athlete 3"]) {
      await expect(getAllCachedLiftingResultsForAthlete(name)).resolves.toEqual([
        expect.objectContaining({ name, date: "2025-01-01" }),
      ]);
    }
  });

  it("restores the previous manifest when a chunk did not persist", async () => {
    await saveAthleteHistory("Jane Doe", [row("Jane Doe", "2025-01-01")]);
    const previousManifest = mockStorage.get(`${HISTORY_PREFIX}jane doe`);
    // The native layer reports success but the chunk is not there on read-back.
    (AsyncStorage.multiSet as jest.Mock).mockImplementationOnce(
      async (pairs: [string, string][]) => {
        pairs
          .filter(([key]) => !key.includes("__chunk_"))
          .forEach(([key, value]) => mockStorage.set(key, value));
      },
    );

    await expect(
      saveAthleteHistory("Jane Doe", [row("Jane Doe", "2026-01-01")]),
    ).rejects.toThrow(/Chunk 0 failed to persist/);

    expect(mockStorage.get(`${HISTORY_PREFIX}jane doe`)).toBe(previousManifest);
    await expect(getAllCachedLiftingResultsForAthlete("Jane Doe")).resolves.toEqual([
      expect.objectContaining({ date: "2025-01-01" }),
    ]);
  });

  it("does not leave a manifest behind when a first write is rejected", async () => {
    (AsyncStorage.multiSet as jest.Mock).mockRejectedValueOnce(new Error("SQLITE_FULL"));

    await expect(saveAthleteHistory("New Athlete", [row("New Athlete", "2026-01-01")])).rejects.toThrow();

    await expect(findAthleteNamesWithoutHistory(["New Athlete"])).resolves.toEqual(["New Athlete"]);
  });

  it("collapses two spellings of one name into a single write, the last winning", async () => {
    await saveAthleteHistoryBatch([
      { name: "Jane Doe", results: [row("Jane Doe", "2025-01-01")] },
      { name: "  jane   DOE ", results: [row("Jane Doe", "2026-01-01")] },
      { name: "   ", results: [row("", "2026-01-01")] },
    ]);

    expect(historyKeys()).toEqual([
      `${HISTORY_PREFIX}jane doe`,
      `${HISTORY_PREFIX}jane doe__chunk_0`,
    ]);
    await expect(getAllCachedLiftingResultsForAthlete("Jane Doe")).resolves.toEqual([
      expect.objectContaining({ date: "2026-01-01" }),
    ]);
  });

  it("still reads a pre-generation manifest and its `__chunk_<n>` keys", async () => {
    await saveAthleteHistory("Jane Doe", [row("Jane Doe", "2025-01-01")]);
    expect(mockStorage.get(`${HISTORY_PREFIX}jane doe`)).toBe(
      '{"format":"deflate-base64-chunks-v1","chunks":1}',
    );
    expect(mockStorage.has(`${HISTORY_PREFIX}jane doe__chunk_0`)).toBe(true);

    await expect(getAllCachedLiftingResultsForAthlete("Jane Doe")).resolves.toHaveLength(1);
  });

  it("rejects a manifest whose generation is not a non-negative integer", async () => {
    mockStorage.set(
      `${HISTORY_PREFIX}jane doe`,
      '{"format":"deflate-base64-chunks-v1","chunks":1,"generation":1.5}',
    );
    mockStorage.set(`${HISTORY_PREFIX}jane doe__chunk_0`, "irrelevant");

    await expect(getAllCachedLiftingResultsForAthlete("Jane Doe")).resolves.toEqual([]);
  });

  it("writes meet results through the same commit-point path", async () => {
    await saveMeetLiftingResults("Meet A", [row("Jane Doe", "2025-01-01")]);
    jest.clearAllMocks();

    await saveMeetLiftingResults("Meet A", [row("Jane Doe", "2025-01-01")]);
    expect(AsyncStorage.multiSet).not.toHaveBeenCalled();

    await saveMeetLiftingResults("Meet A", [row("Jane Doe", "2026-01-01")]);
    expect(AsyncStorage.multiSet).toHaveBeenCalledTimes(1);
    await expect(getMeetLiftingResults("Meet A" as never)).resolves.toEqual([
      expect.objectContaining({ date: "2026-01-01" }),
    ]);
  });
});

describe("athlete history pruning", () => {
  const HISTORY_PREFIX = "meetcal_athlete_history_";
  const BESTS_PREFIX = "meetcal_athlete_bests_";
  const row = (name: string) =>
    ({ id: 1, event_id: "evt", meet: "Meet A", date: "2025-01-01", name, total: 200 }) as any;
  const athlete = (meet: string, name: string) => ({
    memberId: `${meet}-${name}`,
    name,
    age: 25,
    club: "Club",
    gender: "Women",
    weightClass: "71kg",
    entryTotal: 200,
    adaptive: false,
  });
  const keysFor = (name: string) =>
    Array.from(mockStorage.keys()).filter(
      (k) => k.startsWith(`${HISTORY_PREFIX}${name}`) || k === `${BESTS_PREFIX}${name}`,
    );

  beforeEach(async () => {
    mockStorage.clear();
    await initStore();
  });

  it("drops the history of athletes only the expired meet held and keeps shared athletes", async () => {
    await saveMeetAthletes("Expired", [athlete("Expired", "Only Expired"), athlete("Expired", "Shared")] as never);
    await saveMeetAthletes("Kept", [athlete("Kept", "Shared"), athlete("Kept", "Only Kept")] as never);
    await saveAthleteHistoryBatch(
      ["Only Expired", "Shared", "Only Kept"].map((name) => ({ name, results: [row(name)] })),
    );
    await saveAthleteBestsBatch({
      "Only Expired": { snatch_best: 1, cj_best: 2, total: 3 },
      Shared: { snatch_best: 1, cj_best: 2, total: 3 },
    });
    await markMeetExplicitlyDownloaded("Expired" as never, true, { endDate: "2020-01-01" });
    await markMeetExplicitlyDownloaded("Kept" as never, true, { endDate: "2099-01-01" });

    await clearExpiredDownloadedMeets();

    expect(keysFor("only expired")).toEqual([]);
    expect(keysFor("shared").sort()).toEqual([
      `${BESTS_PREFIX}shared`,
      `${HISTORY_PREFIX}shared`,
      `${HISTORY_PREFIX}shared__chunk_0`,
    ]);
    expect(keysFor("only kept")).toHaveLength(2);
    await expect(getAllCachedLiftingResultsForAthlete("Shared")).resolves.toHaveLength(1);
    await expect(getMeetData("Kept" as never)).resolves.toMatchObject({
      athletes: [expect.objectContaining({ name: "Shared" }), expect.objectContaining({ name: "Only Kept" })],
    });
  });

  it("removes exclusive history in bounded multiRemove batches", async () => {
    const names = Array.from({ length: 600 }, (_, i) => `Athlete ${i + 1}`);
    await saveMeetAthletes("Big", names.map((name) => athlete("Big", name)) as never);
    await saveAthleteHistoryBatch(names.map((name) => ({ name, results: [row(name)] })));
    jest.clearAllMocks();

    await clearMeetData("Big" as never);

    // 1200 history keys (manifest + chunk each): every remove is capped at 500.
    const removes = (AsyncStorage.multiRemove as jest.Mock).mock.calls.map(([keys]) => keys.length);
    expect(Math.max(...removes)).toBeLessThanOrEqual(500);
    expect(Array.from(mockStorage.keys()).filter((k) => k.startsWith(HISTORY_PREFIX))).toEqual([]);
  });

  it("does not read other rosters when the cleared meet's athletes have no history", async () => {
    await saveMeetAthletes("Browsed", [athlete("Browsed", "Nobody")] as never);
    await saveMeetAthletes("Downloaded", [athlete("Downloaded", "Somebody")] as never);
    await saveAthleteHistory("Somebody", [row("Somebody")]);
    jest.clearAllMocks();

    await clearMeetData("Browsed" as never);

    const rosterReads = (AsyncStorage.getItem as jest.Mock).mock.calls.filter(
      ([key]) => key === "meetcal_athletes_Downloaded",
    );
    expect(rosterReads).toHaveLength(0);
    expect(keysFor("somebody")).toHaveLength(2);
  });

  it("skips per-meet pruning when every meet is being cleared", async () => {
    await saveMeetAthletes("A", [athlete("A", "One")] as never);
    await saveMeetAthletes("B", [athlete("B", "Two")] as never);
    await saveAthleteHistoryBatch([{ name: "One", results: [row("One")] }, { name: "Two", results: [row("Two")] }]);
    jest.clearAllMocks();

    await clearAllMeetData();

    // `clearAllAthleteHistory` follows in every caller; no roster reads here.
    expect(keysFor("one")).toHaveLength(2);
    expect(keysFor("two")).toHaveLength(2);
  });

  it("prunes history of athletes on no stored roster, keeping the caller's names", async () => {
    await saveMeetAthletes("Kept", [athlete("Kept", "On Roster")] as never);
    await saveAthleteHistoryBatch(
      ["On Roster", "Orphan", "Incoming"].map((name) => ({ name, results: [row(name)] })),
    );
    await saveAthleteBestsBatch({ Orphan: { snatch_best: 1, cj_best: 2, total: 3 } });
    // A chunk orphaned by an interrupted write of an orphaned athlete.
    mockStorage.set(`${HISTORY_PREFIX}orphan__chunk_3_g2`, "stale");
    jest.clearAllMocks();

    await expect(pruneOrphanedAthleteHistory({ keepNames: ["Incoming"] })).resolves.toBe(4);

    expect(keysFor("orphan")).toEqual([]);
    expect(keysFor("on roster")).toHaveLength(2);
    expect(keysFor("incoming")).toHaveLength(2);
    expect(AsyncStorage.getAllKeys).toHaveBeenCalledTimes(1);
  });

  it("returns 0 without reading rosters when no history is stored", async () => {
    await saveMeetAthletes("Kept", [athlete("Kept", "On Roster")] as never);
    jest.clearAllMocks();

    await expect(pruneOrphanedAthleteHistory()).resolves.toBe(0);

    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });
});
