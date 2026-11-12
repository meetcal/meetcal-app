import { getExplicitlyDownloadedMeetIds, markMeetExplicitlyDownloaded } from "@/lib/database/meet-downloads-registry";
import { initStore } from "@/lib/database/offline-store-index";

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
