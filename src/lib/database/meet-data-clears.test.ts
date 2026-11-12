import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearAllAthleteHistory } from "@/lib/database/athlete-history-clears";
import { clearAllMeetData, clearImplicitMeetData, clearMeetData, listStoredMeets } from "@/lib/database/meet-data-clears";
import { clearExpiredDownloadedMeets } from "@/lib/database/downloaded-meet-expiry";
import { PACKAGE_ETAG_STORAGE_KEY } from "@/lib/database/package-etags";
import { getExplicitlyDownloadedMeetIds, markMeetExplicitlyDownloaded } from "@/lib/database/meet-downloads-registry";
import { getMeetData } from "@/lib/database/meet-data-reads";
import { initStore } from "@/lib/database/offline-store-index";
import { saveMeetAthletes } from "@/lib/database/meet-data-saves";
import { captureClearEpoch, registerInFlightPrefetchSettler, resetOfflineClearsForTests, wasClearedSince } from "@/lib/database/offline-clears";

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

  it("skips meets the caller says are still downloading", async () => {
    for (const meet of ["Downloading", "Browsed", "Opening"]) {
      await saveMeetAthletes(meet, [athlete(meet)] as never);
    }

    await clearImplicitMeetData("Opening" as never, {
      skip: (meet) => meet === "Downloading",
    });

    await expect(getMeetData("Downloading" as never)).resolves.toMatchObject({
      athletes: [expect.objectContaining({ name: "Athlete Downloading" })],
    });
    await expect(getMeetData("Browsed" as never)).resolves.toMatchObject({ athletes: [] });
  });
});

describe("clearMeetData and the package ETag", () => {
  beforeEach(async () => {
    mockStorage.clear();
    resetOfflineClearsForTests();
    registerInFlightPrefetchSettler(null);
    await initStore();
  });

  afterEach(() => {
    registerInFlightPrefetchSettler(null);
  });

  it("drops the meet's ETag and keeps the other meets'", async () => {
    mockStorage.set(
      PACKAGE_ETAG_STORAGE_KEY,
      JSON.stringify({ "Meet A": '"a"', "Meet B": '"b"' }),
    );

    await clearMeetData("Meet A" as never);

    expect(JSON.parse(mockStorage.get(PACKAGE_ETAG_STORAGE_KEY) ?? "{}")).toEqual({
      "Meet B": '"b"',
    });
  });

  it("marks the meet cleared and waits for its earlier download before deleting", async () => {
    await saveMeetAthletes("Meet A", [{ name: "Jane Doe", memberId: "1" }] as never);
    const before = captureClearEpoch();
    const order: string[] = [];
    let release!: () => void;
    registerInFlightPrefetchSettler(async (meet) => {
      order.push(`settle:${meet}`);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });

    const clearing = clearMeetData("Meet A" as never);
    expect(wasClearedSince("Meet A", before)).toBe(true);
    expect(wasClearedSince("Meet B", before)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockStorage.has("meetcal_athletes_Meet A")).toBe(true);
    release();
    await clearing;

    expect(order).toEqual(["settle:Meet A"]);
    expect(mockStorage.has("meetcal_athletes_Meet A")).toBe(false);
  });

  it("supersedes every download when all athlete history is cleared", async () => {
    const before = captureClearEpoch();
    const settled: (string | null)[] = [];
    registerInFlightPrefetchSettler(async (meet) => {
      settled.push(meet);
    });

    await clearAllAthleteHistory();

    expect(wasClearedSince("Any Meet", before)).toBe(true);
    expect(settled).toEqual([null]);
  });
});

describe("clearAllMeetData", () => {
  beforeEach(async () => {
    mockStorage.clear();
    await initStore();
  });

  it("finds and clears a meet whose only data is a session's roster", async () => {
    const key = `meetcal_session_athletes_${encodeURIComponent("Saved: Meet")}:3:Red`;
    mockStorage.set(key, "[]");

    const { meetIds } = await listStoredMeets();
    expect(meetIds).toContain("Saved: Meet");

    await clearAllMeetData();
    expect(mockStorage.has(key)).toBe(false);
  });

  it("un-marks a downloaded meet even when none of its data is left, and reports no failures", async () => {
    await markMeetExplicitlyDownloaded("Marked Only" as never, true, { endDate: "2099-06-20" });

    await expect(clearAllMeetData()).resolves.toEqual({ failed: 0 });

    expect(await getExplicitlyDownloadedMeetIds()).toEqual(new Set());
  });
});

describe("clearMeetData failure order", () => {
  const athlete = (meet: string) => ({
    memberId: `${meet}-1`,
    name: `Athlete ${meet}`,
    age: 25,
    club: "Club",
    gender: "Women",
    weightClass: "71kg",
    entryTotal: 200,
    adaptive: false,
    session: {
      number: 1,
      platform: "Red",
      date: "2099-06-20",
      startTime: "9:00 AM",
      weighInTime: "7:00 AM",
    },
  });

  beforeEach(async () => {
    mockStorage.clear();
    await initStore();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("un-marks the download before removing anything, and rejects when a remove fails", async () => {
    await saveMeetAthletes("Meet A", [athlete("Meet A")] as never);
    await markMeetExplicitlyDownloaded("Meet A" as never, true, { endDate: "2099-06-20" });
    const removeItem = AsyncStorage.removeItem as jest.Mock;
    const realRemove = removeItem.getMockImplementation();
    removeItem.mockImplementation(async (key: string) => {
      if (key === "meetcal_athletes_Meet A") throw new Error("I/O error");
      mockStorage.delete(key);
    });

    try {
      await expect(clearMeetData("Meet A" as never)).rejects.toThrow("I/O error");
    } finally {
      removeItem.mockImplementation(realRemove);
    }

    await expect(getExplicitlyDownloadedMeetIds()).resolves.toEqual(new Set());
  });

  it("rejects when the session caches cannot be removed", async () => {
    await saveMeetAthletes("Meet A", [athlete("Meet A")] as never);
    (AsyncStorage.multiRemove as jest.Mock).mockRejectedValueOnce(new Error("SQLITE_BUSY"));

    await expect(clearMeetData("Meet A" as never)).rejects.toThrow("SQLITE_BUSY");
  });

  it("lands both of two concurrent download marks", async () => {
    await Promise.all([
      markMeetExplicitlyDownloaded("Meet A" as never, true, { endDate: "2099-06-20" }),
      markMeetExplicitlyDownloaded("Meet B" as never, true, { endDate: "2099-07-01" }),
    ]);

    await expect(getExplicitlyDownloadedMeetIds()).resolves.toEqual(new Set(["Meet A", "Meet B"]));
  });

  it("keeps marking after an earlier mark's write failed", async () => {
    (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(async () => {
      throw new Error("SQLITE_FULL");
    });
    await expect(
      markMeetExplicitlyDownloaded("Meet A" as never, true, { endDate: "2099-06-20" }),
    ).rejects.toThrow("SQLITE_FULL");

    await markMeetExplicitlyDownloaded("Meet B" as never, true, { endDate: "2099-07-01" });

    await expect(getExplicitlyDownloadedMeetIds()).resolves.toEqual(new Set(["Meet B"]));
  });
});
