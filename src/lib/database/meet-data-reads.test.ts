import { clearMeetData } from "@/lib/database/meet-data-clears";
import { getMeetData, getMeetLiftingResults, getMeetSchedule } from "@/lib/database/meet-data-reads";
import { initStore } from "@/lib/database/offline-store-index";
import { saveMeetLiftingResults, saveMeetSchedule } from "@/lib/database/meet-data-saves";

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

    const chunkKey = Array.from(mockStorage.keys()).find((key) =>
      key.includes("__chunk_0"),
    )!;
    mockStorage.set(chunkKey, "not base64 deflate");

    await expect(getMeetLiftingResults("Test Meet")).resolves.toEqual([]);
  });

  it.each([
    ["invalid JSON", "{\"not\": "],
    ["valid JSON that is not an array", "{\"sessions\":[]}"],
    ["a day with no sessions list", "[{\"date\":\"2026-06-20\",\"fullDate\":\"2026-06-20\"}]"],
    ["a session with no platforms list", "[{\"date\":\"2026-06-20\",\"fullDate\":\"2026-06-20\",\"sessions\":[{\"id\":\"1\",\"number\":1}]}]"],
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
