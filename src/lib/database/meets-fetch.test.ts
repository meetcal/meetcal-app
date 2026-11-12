import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchMeetsFresh } from "@/lib/database/meets-fetch";
import { getCachedMeets } from "@/lib/database/meets-list-cache";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
    multiSet: jest.fn(async () => undefined),
    multiGet: jest.fn(async () => []),
    multiRemove: jest.fn(async () => undefined),
  },
}));

jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(async () => true),
}));

const mockFetchSchedule = jest.fn();

const mockFetchAthletesWithSession = jest.fn();

const mockFetchApiMeetPackage = jest.fn();

type MockPackageFetch =
  | { status: "fresh"; etag: string | null; package: unknown }
  | { status: "not_modified" };

const mockFetchApiMeetPackageConditional = jest.fn(
  async (
    meet: string,
    cutoff?: string,
    _ifNoneMatch?: string | null,
  ): Promise<MockPackageFetch> => ({
    status: "fresh",
    etag: null,
    package: await mockFetchApiMeetPackage(meet, cutoff),
  }),
);

const mockFetchApiResultsByNames = jest.fn(
  async (_names: string[]): Promise<any[]> => [],
);

const mockFetchApiMeets = jest.fn(async (): Promise<unknown[]> => []);

const mockSaveAthleteHistory = jest.fn(async () => undefined);

const mockSaveAthleteHistoryBatch = jest.fn(
  async (entries: readonly { name: string; results: unknown[] }[]): Promise<number> => {
    for (const entry of entries) {
      await (mockSaveAthleteHistory as jest.Mock)(entry.name, entry.results);
    }
    return entries.length;
  },
);

const mockPruneOrphanedAthleteHistory = jest.fn(
  async (_options?: { keepNames?: readonly string[] }): Promise<number> => 0,
);

const mockClearImplicitMeetData = jest.fn(async (_meet?: string): Promise<void> => undefined);

const mockSaveMeetSchedule = jest.fn(async () => undefined);

const mockSaveMeetAthletes = jest.fn(async (): Promise<boolean> => true);

const mockFindAthleteNamesWithoutHistory = jest.fn(
  async (_names: readonly string[]): Promise<string[]> => [],
);

let mockIsExplicitlyDownloaded: (meet: string) => boolean = () => true;

const mockGetMeetLiftingResults = jest.fn(async (_meet: string): Promise<any[]> => []);

const mockClearMeetData = jest.fn(
  async (_meet: string): Promise<void> => undefined,
);

const mockGetMeetAthletesSyncedAt = jest.fn(async (_meet: string): Promise<number> => 0);

jest.mock("@/lib/database/queries", () => ({
  fetchSchedule: (...args: unknown[]) => mockFetchSchedule(...args),
  fetchAthletesWithSession: (...args: unknown[]) =>
    mockFetchAthletesWithSession(...args),
}));

jest.mock("@/lib/api/meet-package-api", () => ({
  ...jest.requireActual("@/lib/api/meet-package-api"),
  fetchApiMeetPackageConditional: (...args: unknown[]) =>
    mockFetchApiMeetPackageConditional(
      ...(args as [string, string | undefined, string | null | undefined]),
    ),
}));

jest.mock("@/lib/api/results-api", () => ({
  ...jest.requireActual("@/lib/api/results-api"),
  fetchApiResultsByNames: (...args: unknown[]) =>
    mockFetchApiResultsByNames(...(args as [string[]])),
}));

jest.mock("@/lib/api/meets-api", () => ({
  ...jest.requireActual("@/lib/api/meets-api"),
  fetchApiMeets: () => mockFetchApiMeets(),
}));

jest.mock("@/lib/database/meet-data-clears", () => ({
  clearImplicitMeetData: (...args: unknown[]) =>
    mockClearImplicitMeetData(...(args as [string | undefined])),
  clearMeetData: (...args: unknown[]) => mockClearMeetData.apply(null, args),
}));

jest.mock("@/lib/database/athlete-history-clears", () => ({
  pruneOrphanedAthleteHistory: (...args: unknown[]) =>
    mockPruneOrphanedAthleteHistory(...(args as [{ keepNames?: readonly string[] } | undefined])),
}));

jest.mock("@/lib/database/meet-data-reads", () => ({
  getMeetData: jest.fn(async () => ({
    schedule: null,
    scheduleKey: "",
    athletesKey: "",
    athletes: [],
    liftingResultsKey: "",
    lastSyncTime: 0,
  })),
  getMeetLiftingResults: (meet: string) => mockGetMeetLiftingResults(meet),
}));

jest.mock("@/lib/database/meet-downloads-registry", () => ({
  isMeetExplicitlyDownloaded: async (meet: string) =>
    mockIsExplicitlyDownloaded(meet),
  getExplicitlyDownloadedMeetIds: async () => ({
    has: (meet: string) => mockIsExplicitlyDownloaded(meet),
  }),
}));

jest.mock("@/lib/database/offline-store-index", () => ({
  getMeetAthletesSyncedAt: (meet: string) => mockGetMeetAthletesSyncedAt(meet),
}));

jest.mock("@/lib/database/athlete-history-store", () => ({
  saveAthleteHistoryBatch: (entries: readonly { name: string; results: unknown[] }[]) =>
    mockSaveAthleteHistoryBatch(entries),
  findAthleteNamesWithoutHistory: (names: readonly string[]) =>
    mockFindAthleteNamesWithoutHistory(names),
}));

jest.mock("@/lib/database/athlete-bests-store", () => ({
  saveAthleteBestsBatch: jest.fn(async () => undefined),
}));

jest.mock("@/lib/database/meet-data-saves", () => ({
  saveMeetAthletes: (...args: unknown[]) =>
    mockSaveMeetAthletes.apply(null, args),
  saveMeetLiftingResults: jest.fn(async () => undefined),
  saveMeetSchedule: (...args: unknown[]) =>
    mockSaveMeetSchedule.apply(null, args),
}));

const mockGetItem = AsyncStorage.getItem as jest.Mock;

function useBackedStorage(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  mockGetItem.mockImplementation(async (key: string) => store.get(key) ?? null);
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
    store.set(key, value);
  });
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(async (key: string) => {
    store.delete(key);
  });
  (AsyncStorage.multiRemove as jest.Mock).mockImplementation(async (keys: string[]) => {
    keys.forEach((key) => store.delete(key));
  });
  return store;
}

function resetStorageMocks() {
  mockGetItem.mockImplementation(async () => null);
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async () => undefined);
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(async () => undefined);
  (AsyncStorage.multiRemove as jest.Mock).mockImplementation(async () => undefined);
}

describe("fetchMeetsFresh and the cached meets list", () => {
  const MEETS_LIST_CACHE_KEY = "@meets_list_cache_v1";
  const meet = (name: string) => ({
    name,
    dates: { start: "2099-06-20", end: "2099-06-22" },
    time: { timeZoneIdentifier: "America/New_York" },
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    resetStorageMocks();
  });

  it("keeps the cached list when /meets answers with no meets, but still returns none", async () => {
    const store = useBackedStorage({
      [MEETS_LIST_CACHE_KEY]: JSON.stringify([meet("Meet A"), meet("Meet B")]),
    });
    mockFetchApiMeets.mockResolvedValueOnce([]);

    await expect(fetchMeetsFresh()).resolves.toEqual([]);

    const cached = await getCachedMeets();
    expect(cached.map((m) => m.name)).toEqual(["Meet A", "Meet B"]);
    expect(JSON.parse(store.get(MEETS_LIST_CACHE_KEY) ?? "[]")).toHaveLength(2);
  });

  it("still writes a non-empty answer over the cache", async () => {
    const store = useBackedStorage({
      [MEETS_LIST_CACHE_KEY]: JSON.stringify([meet("Meet A"), meet("Meet B")]),
    });
    mockFetchApiMeets.mockResolvedValueOnce([meet("Meet C")]);

    await fetchMeetsFresh();

    expect(JSON.parse(store.get(MEETS_LIST_CACHE_KEY) ?? "[]").map((m: { name: string }) => m.name)).toEqual([
      "Meet C",
    ]);
  });

  it("writes an empty answer when there was no cache to lose", async () => {
    const store = useBackedStorage();
    mockFetchApiMeets.mockResolvedValueOnce([]);

    await fetchMeetsFresh();

    expect(store.get(MEETS_LIST_CACHE_KEY)).toBe("[]");
  });
});
