import { initStore } from "@/lib/database/offline-store-index";
import { getSessionAthletesFromMeetCache } from "@/lib/database/session-roster-cache";
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

describe("per-session roster caches", () => {
  beforeEach(async () => {
    mockStorage.clear();
    await initStore();
  });

  const lifter = (name: string, platform: string) => ({
    memberId: name,
    name,
    age: 25,
    club: "Club",
    gender: "Women",
    weightClass: "71kg",
    entryTotal: 200,
    adaptive: false,
    session: { number: 12, platform, date: "2026-06-20", startTime: "9:00 AM", weighInTime: "7:00 AM" },
  });

  it("drops the cache of a session the new roster no longer has", async () => {
    await saveMeetAthletes("Merge Meet", [lifter("Ann", "Red"), lifter("Bea", "Blue")] as never);
    await expect(getSessionAthletesFromMeetCache("Merge Meet" as never, 12, "Blue")).resolves.toHaveLength(1);

    await saveMeetAthletes("Merge Meet", [lifter("Ann", "Red"), lifter("Bea", "Red")] as never);

    const sessionKeys = Array.from(mockStorage.keys()).filter((key) =>
      key.startsWith("meetcal_session_athletes_Merge%20Meet:"),
    );
    expect(sessionKeys).toHaveLength(1);
    await expect(getSessionAthletesFromMeetCache("Merge Meet" as never, 12, "Blue")).resolves.toEqual([]);
    await expect(getSessionAthletesFromMeetCache("Merge Meet" as never, 12, "Red")).resolves.toHaveLength(2);
  });

  it("leaves other meets' session caches alone", async () => {
    await saveMeetAthletes("Other Meet", [lifter("Cat", "Blue")] as never);
    await saveMeetAthletes("Merge Meet", [lifter("Ann", "Red")] as never);

    await expect(getSessionAthletesFromMeetCache("Other Meet" as never, 12, "Blue")).resolves.toHaveLength(1);
  });
});
