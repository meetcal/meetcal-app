import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearExpiredDownloadedMeets, hasMeetEnded } from "@/lib/database/downloaded-meet-expiry";
import { getExplicitlyDownloadedMeetIds, markMeetExplicitlyDownloaded } from "@/lib/database/meet-downloads-registry";
import { getMeetData } from "@/lib/database/meet-data-reads";
import { initStore } from "@/lib/database/offline-store-index";
import { saveMeetAthletes } from "@/lib/database/meet-data-saves";

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

describe("downloaded meet expiry on the server's clock", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
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
  const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

  beforeEach(async () => {
    mockStorage.clear();
    await initStore();
    mockTrustedNow = () => new Date();
  });

  afterEach(() => {
    jest.useRealTimers();
    mockTrustedNow = () => new Date();
  });

  it("leaves an ended meet alone when there is no server clock sample yet", async () => {
    await saveMeetAthletes("Ended", [athlete("Ended")] as never);
    await markMeetExplicitlyDownloaded("Ended" as never, true, { endDate: "2020-01-01" });
    mockTrustedNow = () => null;

    await clearExpiredDownloadedMeets();

    await expect(isMeetExplicitlyDownloadedFor("Ended")).resolves.toBe(true);
    await expect(getMeetData("Ended" as never)).resolves.toMatchObject({
      athletes: [expect.objectContaining({ name: "Athlete Ended" })],
    });
  });

  it("clears an ended meet once the server clock says it has ended", async () => {
    await saveMeetAthletes("Ended", [athlete("Ended")] as never);
    await markMeetExplicitlyDownloaded("Ended" as never, true, { endDate: "2020-01-01" });
    mockTrustedNow = () => new Date();

    await clearExpiredDownloadedMeets();

    await expect(isMeetExplicitlyDownloadedFor("Ended")).resolves.toBe(false);
    await expect(getMeetData("Ended" as never)).resolves.toMatchObject({ athletes: [] });
  });

  it("keeps today's meet when only the device clock, a day ahead, says it ended", async () => {
    const realNow = Date.now();
    await saveMeetAthletes("Today", [athlete("Today")] as never);
    await markMeetExplicitlyDownloaded("Today" as never, true, { endDate: isoDate(realNow) });
    jest.useFakeTimers();
    jest.setSystemTime(realNow + 2 * DAY_MS);
    mockTrustedNow = () => new Date(realNow);

    await clearExpiredDownloadedMeets();

    await expect(isMeetExplicitlyDownloadedFor("Today")).resolves.toBe(true);
    await expect(getMeetData("Today" as never)).resolves.toMatchObject({
      athletes: [expect.objectContaining({ name: "Athlete Today" })],
    });
  });

  it("keeps sweeping when one meet fails to clear", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    for (const meet of ["Bad", "Good"]) {
      await saveMeetAthletes(meet, [athlete(meet)] as never);
      await markMeetExplicitlyDownloaded(meet as never, true, { endDate: "2020-01-01" });
    }
    const removeItem = AsyncStorage.removeItem as jest.Mock;
    const realRemove = removeItem.getMockImplementation();
    removeItem.mockImplementation(async (key: string) => {
      if (key === "meetcal_athletes_Bad") throw new Error("I/O error");
      mockStorage.delete(key);
    });

    try {
      await clearExpiredDownloadedMeets();
    } finally {
      removeItem.mockImplementation(realRemove);
    }

    await expect(getMeetData("Good" as never)).resolves.toMatchObject({ athletes: [] });
    jest.restoreAllMocks();
  });

  const listMeets = (meets: { name: string; end: string }[]) =>
    mockStorage.set(
      "@meets_list_cache_v1",
      JSON.stringify(
        meets.map(({ name, end }) => ({
          name,
          dates: { start: end, end },
          time: { timeZoneIdentifier: "America/New_York" },
        })),
      ),
    );

  it("expires a postponed meet on its current end date from the meets list, and remembers it", async () => {
    await saveMeetAthletes("Postponed", [athlete("Postponed")] as never);
    await markMeetExplicitlyDownloaded("Postponed" as never, true, { endDate: "2020-01-01" });
    listMeets([{ name: "Postponed", end: "2099-06-20" }]);

    await clearExpiredDownloadedMeets();

    await expect(isMeetExplicitlyDownloadedFor("Postponed")).resolves.toBe(true);
    const downloads = JSON.parse(mockStorage.get("meetcal_explicit_meet_downloads") ?? "{}");
    expect(downloads.Postponed.endDate).toBe("2099-06-20");

    mockStorage.delete("@meets_list_cache_v1");
    await clearExpiredDownloadedMeets();
    await expect(isMeetExplicitlyDownloadedFor("Postponed")).resolves.toBe(true);
  });

  it("expires a meet the list says has ended even though the stored date is later", async () => {
    await saveMeetAthletes("Moved Up", [athlete("Moved Up")] as never);
    await markMeetExplicitlyDownloaded("Moved Up" as never, true, { endDate: "2099-06-20" });
    listMeets([{ name: "Moved Up", end: "2020-01-01" }]);

    await clearExpiredDownloadedMeets();

    await expect(isMeetExplicitlyDownloadedFor("Moved Up")).resolves.toBe(false);
  });

  it("still clears ended meets when saving the listed end dates fails", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    await saveMeetAthletes("Ended", [athlete("Ended")] as never);
    await markMeetExplicitlyDownloaded("Ended" as never, true, { endDate: "2020-01-01" });
    await markMeetExplicitlyDownloaded("Moved" as never, true, { endDate: "2099-06-20" });
    listMeets([{ name: "Moved", end: "2099-07-01" }]);
    const setItem = AsyncStorage.setItem as jest.Mock;
    const realSet = setItem.getMockImplementation();
    setItem.mockImplementationOnce(async () => {
      throw new Error("database or disk is full (code 13 SQLITE_FULL)");
    });

    try {
      await clearExpiredDownloadedMeets();
    } finally {
      if (realSet) setItem.mockImplementation(realSet);
    }

    await expect(isMeetExplicitlyDownloadedFor("Ended")).resolves.toBe(false);
    await expect(getMeetData("Ended" as never)).resolves.toMatchObject({ athletes: [] });
    jest.restoreAllMocks();
  });

  async function isMeetExplicitlyDownloadedFor(meet: string): Promise<boolean> {
    return (await getExplicitlyDownloadedMeetIds()).has(meet);
  }
});

describe("hasMeetEnded", () => {
  it("waits until the end date is over everywhere on Earth (UTC-12)", () => {
    expect(hasMeetEnded("2026-06-20", Date.parse("2026-06-21T10:30:00Z"))).toBe(false);
    expect(hasMeetEnded("2026-06-20", Date.parse("2026-06-21T11:59:00Z"))).toBe(false);
    expect(hasMeetEnded("2026-06-20", Date.parse("2026-06-21T12:01:00Z"))).toBe(true);
  });

  it("never treats an unreadable end date as ended", () => {
    expect(hasMeetEnded("TBD", Date.parse("2030-01-01T00:00:00Z"))).toBe(false);
  });
});
