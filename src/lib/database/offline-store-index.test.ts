import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearAllMeetData, clearMeetData, listStoredMeets } from "@/lib/database/meet-data-clears";
import { getMeetData, getMeetSchedule } from "@/lib/database/meet-data-reads";
import { getMeetWriteGeneration, initStore } from "@/lib/database/offline-store-index";
import { saveMeetAthletes, saveMeetSchedule } from "@/lib/database/meet-data-saves";

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

describe("meet write generation", () => {
  beforeEach(async () => {
    mockStorage.clear();
    await initStore();
  });

  const schedule = [
    {
      date: "2026-06-20",
      fullDate: "2026-06-20",
      sessions: [{ id: "s1", number: 1, startTime: "10:00 AM", weighInTime: "8:00 AM", platforms: [] }],
    },
  ] as any;

  it("changes when a write to the meet is queued and again when it lands", async () => {
    const before = getMeetWriteGeneration("Gen Meet");
    const saving = saveMeetSchedule("Gen Meet", schedule);
    const queued = getMeetWriteGeneration("Gen Meet");
    expect(queued).not.toBe(before);

    await saving;
    await Promise.resolve();
    expect(getMeetWriteGeneration("Gen Meet")).not.toBe(queued);
  });

  it("changes for clears and roster writes, and only for that meet", async () => {
    const other = getMeetWriteGeneration("Other Meet");
    let last = getMeetWriteGeneration("Gen Meet");
    for (const write of [
      () => saveMeetAthletes("Gen Meet", [{ name: "A", meet: "Gen Meet" }] as any),
      () => clearMeetData("Gen Meet" as any),
    ]) {
      await write();
      await Promise.resolve();
      const next = getMeetWriteGeneration("Gen Meet");
      expect(next).not.toBe(last);
      last = next;
    }
    expect(getMeetWriteGeneration("Other Meet")).toBe(other);
  });

  it("is left alone by reads", async () => {
    await saveMeetSchedule("Gen Meet", schedule);
    await Promise.resolve();
    const settled = getMeetWriteGeneration("Gen Meet");
    await getMeetSchedule("Gen Meet");
    await getMeetData("Gen Meet" as any);
    expect(getMeetWriteGeneration("Gen Meet")).toBe(settled);
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
    await clearMeetData("New Meet" as never);
    const stored = JSON.parse(mockStorage.get(STORE_KEY) ?? "{}");
    expect(Object.keys(stored.meets).sort()).toEqual(["Bare Meet", "Good Meet"]);
    expect(stored.meets["Good Meet"].lastSyncTime).toBe(5);
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

describe("store index writes", () => {
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
  const storedMeetIds = () =>
    Object.keys(JSON.parse(mockStorage.get("meetcal_offline_store") ?? "{}").meets ?? {}).sort();

  beforeEach(async () => {
    mockStorage.clear();
    await initStore();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps an entry another meet saved while a clear was in flight", async () => {
    await saveMeetAthletes("Old Meet", [athlete("Old Meet")] as never);
    const getAllKeys = AsyncStorage.getAllKeys as jest.Mock;
    let releaseListing!: () => void;
    const listingGate = new Promise<void>((resolve) => {
      releaseListing = resolve;
    });
    getAllKeys.mockImplementationOnce(async () => {
      await listingGate;
      return Array.from(mockStorage.keys());
    });

    const clearing = clearMeetData("Old Meet" as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await saveMeetAthletes("New Meet", [athlete("New Meet")] as never);
    releaseListing();
    await clearing;

    expect(storedMeetIds()).toEqual(["New Meet"]);
    await expect(getMeetData("New Meet" as never)).resolves.toMatchObject({
      athletes: [expect.objectContaining({ name: "Athlete New Meet" })],
    });
  });

  it("keeps what a meet saved while its own clear was in flight", async () => {
    await saveMeetAthletes("Reopened", [athlete("Old Roster")] as never);
    const removeItem = AsyncStorage.removeItem as jest.Mock;
    let releaseRemoval!: () => void;
    const removalGate = new Promise<void>((resolve) => {
      releaseRemoval = resolve;
    });
    let parked = false;
    removeItem.mockImplementationOnce(async (key: string) => {
      parked = true;
      await removalGate;
      mockStorage.delete(key);
    });

    const clearing = clearMeetData("Reopened" as never);
    for (let i = 0; i < 20 && !parked; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(parked).toBe(true);
    const saving = saveMeetAthletes("Reopened", [athlete("New Roster")] as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseRemoval();
    await Promise.all([clearing, saving]);

    await expect(getMeetData("Reopened" as never)).resolves.toMatchObject({
      athletes: [expect.objectContaining({ name: "Athlete New Roster" })],
    });
  });

  it("lands every entry of concurrent saves for different meets", async () => {
    await Promise.all(
      ["A", "B", "C", "D"].map((meet) => saveMeetAthletes(meet, [athlete(meet)] as never)),
    );

    expect(storedMeetIds()).toEqual(["A", "B", "C", "D"]);
  });

  it("keeps writing the index after one write failed", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const setItem = AsyncStorage.setItem as jest.Mock;
    const realSetItem = setItem.getMockImplementation();
    let failedOnce = false;
    setItem.mockImplementation(async (key: string, value: string) => {
      if (key === "meetcal_offline_store" && !failedOnce) {
        failedOnce = true;
        throw new Error("SQLITE_BUSY");
      }
      mockStorage.set(key, value);
    });
    try {
      await saveMeetAthletes("A", [athlete("A")] as never);
    } finally {
      setItem.mockImplementation(realSetItem);
    }
    await saveMeetAthletes("B", [athlete("B")] as never);

    expect(storedMeetIds()).toEqual(["B"]);
  });

  it("clears a meet's data by its fixed key names when its index entry is gone", async () => {
    mockStorage.set("meetcal_schedule_Lost Meet", "[]");
    mockStorage.set("meetcal_athletes_Lost Meet", "[]");
    mockStorage.set(
      "meetcal_lifting_results_Lost Meet",
      JSON.stringify({ format: "deflate-base64-chunks-v1", chunks: 1 }),
    );
    mockStorage.set("meetcal_lifting_results_Lost Meet__chunk_0", "abc");
    mockStorage.set("meetcal_lifting_results_Lost Meet__chunk_4_g3", "stale");
    mockStorage.set("meetcal_session_athletes_Lost%20Meet:1:Red", "[]");
    mockStorage.set("meetcal_lifting_results_Lost Meet 2", "[]");

    await clearMeetData("Lost Meet" as never);

    expect(Array.from(mockStorage.keys()).filter((k) => k.includes("Lost")).sort()).toEqual([
      "meetcal_lifting_results_Lost Meet 2",
    ]);
  });

  it("finds and clears meets that have data on disk but no index entry", async () => {
    await saveMeetAthletes("Indexed", [athlete("Indexed")] as never);
    mockStorage.set("meetcal_schedule_Orphaned", "[]");
    mockStorage.set("meetcal_lifting_results_Orphaned__chunk_0", "abc");

    const { meetIds } = await listStoredMeets(["In Window"]);
    expect([...meetIds].sort()).toEqual(["In Window", "Indexed", "Orphaned"]);

    await clearAllMeetData();

    expect(Array.from(mockStorage.keys()).filter((k) => k.includes("Orphaned"))).toEqual([]);
    expect(mockStorage.has("meetcal_athletes_Indexed")).toBe(false);
  });

  it("does not write the index back when reading it finds no valid payload", async () => {
    mockStorage.set("meetcal_offline_store", "{truncated");
    const setItem = AsyncStorage.setItem as jest.Mock;
    setItem.mockClear();

    await expect(getMeetSchedule("Some Meet")).resolves.toEqual([]);
    expect(setItem.mock.calls.filter(([key]) => key === "meetcal_offline_store")).toHaveLength(0);

    await getMeetData("Some Meet" as never);

    const indexWrites = setItem.mock.calls.filter(([key]) => key === "meetcal_offline_store");
    expect(indexWrites).toHaveLength(0);
    expect(mockStorage.get("meetcal_offline_store")).toBe("{truncated");
  });

  it("adds no entry on a read and removes the entry when the meet is cleared", async () => {
    await getMeetData("Only Read" as never);
    expect(storedMeetIds()).toEqual([]);

    await saveMeetAthletes("Opened", [athlete("Opened")] as never);
    expect(storedMeetIds()).toEqual(["Opened"]);
    await clearMeetData("Opened" as never);
    expect(storedMeetIds()).toEqual([]);
    expect(mockStorage.has("meetcal_athletes_Opened")).toBe(false);
  });
});
