import AsyncStorage from "@react-native-async-storage/async-storage";
import { prefetchCriticalMeetData, prefetchMeetData } from "@/lib/database/meet-manager";
import { touchMeetAccess } from "@/lib/database/meet-cache-eviction";
import type { Schedule } from "@/types/schedule";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
    setMany: jest.fn(async () => undefined),
    getMany: jest.fn(async () => ({})),
    removeMany: jest.fn(async () => undefined),
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

const setExplicitlyDownloaded = (predicate: (meet: string) => boolean) => {
  mockIsExplicitlyDownloaded = predicate;
};

const mockGetMeetLiftingResults = jest.fn(async (_meet: string): Promise<any[]> => []);

const mockClearMeetData = jest.fn(
  async (_meet: string): Promise<void> => undefined,
);

const mockGetMeetAthletesSyncedAt = jest.fn(async (_meet: string): Promise<number> => 0);

const mockFetchRosterTagged = jest.fn(async (meet: string, _knownTag: string | null) => ({
  status: "fresh" as const,
  value: await mockFetchAthletesWithSession(meet),
  tag: null,
}));

jest.mock("@/lib/database/queries", () => ({
  fetchSchedule: (...args: unknown[]) => mockFetchSchedule(...args),
  fetchRosterTagged: (meet: string, knownTag: string | null) => mockFetchRosterTagged(meet, knownTag),
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
  getMeetAthletesTag: async () => null,
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
  markMeetAthletesCurrent: jest.fn(async () => undefined),
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
  (AsyncStorage.removeMany as jest.Mock).mockImplementation(async (keys: string[]) => {
    keys.forEach((key) => store.delete(key));
  });
  return store;
}

function resetStorageMocks() {
  mockGetItem.mockImplementation(async () => null);
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async () => undefined);
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(async () => undefined);
  (AsyncStorage.removeMany as jest.Mock).mockImplementation(async () => undefined);
}

describe("cache eviction during prefetch", () => {
  const MEET_CACHE_KEY = "@meet_cache_info";

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchAthletesWithSession.mockResolvedValue([]);
    mockFetchSchedule.mockResolvedValue([
      {
        date: "Future Day 1",
        fullDate: "2099-01-01",
        sessions: [
          {
            id: "session-1",
            number: 1,
            startTime: "8:00 AM",
            weighInTime: "6:00 AM",
            platforms: [{ platform: "Red", weightClass: "Red class" }],
          },
        ],
      },
    ] as Schedule);
  });

  afterEach(() => {
    mockGetItem.mockImplementation(async () => null);
  });

  it("drops malformed cache entries before eviction and recomputes size", async () => {
    mockGetItem.mockImplementation(async (key: string) =>
      key === MEET_CACHE_KEY ? JSON.stringify({
        totalSize: "broken",
        meets: {
          "Valid Meet": { lastAccessed: 1, size: 10 },
          "Null Meet": null,
          "Invalid Size": { lastAccessed: 2, size: "huge" },
          "Invalid Access": { lastAccessed: null, size: 10 },
        },
      }) : null,
    );
    await touchMeetAccess("New Meet");
    const calls = (AsyncStorage.setItem as jest.Mock).mock.calls;
    const [key, value] = calls[calls.length - 1];
    expect(key).toBe(MEET_CACHE_KEY);
    expect(JSON.parse(value)).toEqual({
      totalSize: 10,
      meets: {
        "Valid Meet": { lastAccessed: 1, size: 10 },
        "New Meet": { lastAccessed: expect.any(Number), size: 0 },
      },
    });
    await expect(prefetchCriticalMeetData("New Meet")).resolves.toBeUndefined();
  });

  it("evicts the least-recently-used implicit meets but keeps explicitly downloaded ones", async () => {
    const cacheInfo = {
      totalSize: 0,
      meets: {
        "Downloaded Meet": { lastAccessed: 1, size: 0 },
        "Meet E": { lastAccessed: 5, size: 0 },
        "Meet D": { lastAccessed: 4, size: 0 },
        "Meet C": { lastAccessed: 3, size: 0 },
        "Meet B": { lastAccessed: 2, size: 0 },
      },
    };
    mockGetItem.mockImplementation(async (key: string) =>
      key === MEET_CACHE_KEY ? JSON.stringify(cacheInfo) : null,
    );
    setExplicitlyDownloaded((meet) => meet === "Downloaded Meet");

    await prefetchCriticalMeetData("Meet F" as any);

    const clearedMeets = mockClearMeetData.mock.calls.map(([meet]) => meet);
    expect(clearedMeets).toContain("Meet B");
    expect(clearedMeets).not.toContain("Downloaded Meet");
    expect(clearedMeets).not.toContain("Meet E");
    expect(clearedMeets).not.toContain("Meet D");
    expect(clearedMeets).not.toContain("Meet C");
  });

  it("keeps an access stamped while the sweep is clearing a meet", async () => {
    const store = useBackedStorage({
      [MEET_CACHE_KEY]: JSON.stringify({
        totalSize: 0,
        meets: {
          "Meet E": { lastAccessed: 5, size: 0 },
          "Meet D": { lastAccessed: 4, size: 0 },
          "Meet B": { lastAccessed: 2, size: 0 },
        },
      }),
    });
    setExplicitlyDownloaded(() => false);
    let releaseClear!: () => void;
    const clearGate = new Promise<void>((resolve) => {
      releaseClear = resolve;
    });
    mockClearMeetData.mockImplementationOnce(() => clearGate);

    try {
      const opening = prefetchCriticalMeetData("Meet F" as any);
      for (let i = 0; i < 50 && mockClearMeetData.mock.calls.length === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(mockClearMeetData).toHaveBeenCalledWith("Meet B");
      await touchMeetAccess("Meet G" as any);
      releaseClear();
      await opening;

      const info = JSON.parse(store.get(MEET_CACHE_KEY)!);
      expect(Object.keys(info.meets).sort()).toEqual(["Meet D", "Meet E", "Meet F", "Meet G"]);
    } finally {
      resetStorageMocks();
    }
  });

  it("keeps the access stamp of a meet reopened while it was being cleared", async () => {
    const store = useBackedStorage({
      [MEET_CACHE_KEY]: JSON.stringify({
        totalSize: 0,
        meets: {
          "Meet E": { lastAccessed: 5, size: 0 },
          "Meet D": { lastAccessed: 4, size: 0 },
          "Meet B": { lastAccessed: 2, size: 0 },
        },
      }),
    });
    setExplicitlyDownloaded(() => false);
    let releaseClear!: () => void;
    const clearGate = new Promise<void>((resolve) => {
      releaseClear = resolve;
    });
    mockClearMeetData.mockImplementationOnce(() => clearGate);

    try {
      const opening = prefetchCriticalMeetData("Meet F" as any);
      for (let i = 0; i < 50 && mockClearMeetData.mock.calls.length === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(mockClearMeetData).toHaveBeenCalledWith("Meet B");
      await touchMeetAccess("Meet B" as any);
      releaseClear();
      await opening;

      const info = JSON.parse(store.get(MEET_CACHE_KEY)!);
      expect(info.meets["Meet B"]).toEqual({ lastAccessed: expect.any(Number), size: 0 });
      expect(info.meets["Meet B"].lastAccessed).toBeGreaterThan(5);
    } finally {
      resetStorageMocks();
    }
  });

  it("does not evict a meet whose open starts while its ETag is being cleared", async () => {
    const store = useBackedStorage({
      [MEET_CACHE_KEY]: JSON.stringify({
        totalSize: 0,
        meets: {
          "Meet E": { lastAccessed: 5, size: 0 },
          "Meet D": { lastAccessed: 4, size: 0 },
          "Meet B": { lastAccessed: 2, size: 0 },
        },
      }),
    });
    setExplicitlyDownloaded(() => false);
    const setItem = AsyncStorage.setItem as jest.Mock;
    const backedSetItem = setItem.getMockImplementation()!;
    let releaseEtag!: () => void;
    const etagGate = new Promise<void>((resolve) => {
      releaseEtag = resolve;
    });
    let etagParked = false;
    setItem.mockImplementation(async (key: string, value: string) => {
      if (key === "@meet_package_etag_v1" && !etagParked) {
        etagParked = true;
        await etagGate;
      }
      return backedSetItem(key, value);
    });
    let releaseRoster!: (value: unknown[]) => void;
    mockFetchAthletesWithSession.mockImplementation((meet: string) =>
      meet === "Meet B"
        ? new Promise((resolve) => {
            releaseRoster = resolve;
          })
        : Promise.resolve([]),
    );

    try {
      const openingF = prefetchCriticalMeetData("Meet F" as any);
      for (let i = 0; i < 50 && !etagParked; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(etagParked).toBe(true);
      const openingB = prefetchCriticalMeetData("Meet B" as any);
      releaseEtag();
      await openingF;

      expect(mockClearMeetData).not.toHaveBeenCalledWith("Meet B");
      releaseRoster([]);
      await openingB;
      expect(JSON.parse(store.get(MEET_CACHE_KEY)!).meets["Meet B"]).toBeDefined();
    } finally {
      resetStorageMocks();
      mockFetchAthletesWithSession.mockResolvedValue([]);
    }
  });

  it("does not evict a meet that is being opened", async () => {
    useBackedStorage({
      [MEET_CACHE_KEY]: JSON.stringify({
        totalSize: 0,
        meets: {
          "Meet E": { lastAccessed: 5, size: 0 },
          "Meet D": { lastAccessed: 4, size: 0 },
          "Meet C": { lastAccessed: 3, size: 0 },
          "Meet B": { lastAccessed: 2, size: 0 },
        },
      }),
    });
    setExplicitlyDownloaded(() => false);
    let releaseRoster!: (value: unknown[]) => void;
    mockFetchAthletesWithSession.mockImplementation((meet: string) =>
      meet === "Meet B"
        ? new Promise((resolve) => {
            releaseRoster = resolve;
          })
        : Promise.resolve([]),
    );

    try {
      const openingB = prefetchCriticalMeetData("Meet B" as any);
      await prefetchCriticalMeetData("Meet F" as any);

      expect(mockClearMeetData).not.toHaveBeenCalledWith("Meet B");
      releaseRoster([]);
      await openingB;
    } finally {
      resetStorageMocks();
      mockFetchAthletesWithSession.mockResolvedValue([]);
    }
  });
});

describe("eviction during a full prefetch", () => {
  const MEET_CACHE_KEY = "@meet_cache_info";
  const buildAthlete = (name: string) => ({
    member_id: name,
    name,
    age: 25,
    club: "Club",
    wso: null,
    gender: "Male",
    weight_class: "81",
    entry_total: 0,
    adaptive: false,
    session: null,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchAthletesWithSession.mockResolvedValue([]);
    mockFetchSchedule.mockResolvedValue([]);
    setExplicitlyDownloaded(() => false);
  });

  afterEach(() => {
    resetStorageMocks();
    setExplicitlyDownloaded(() => true);
  });

  it("never evicts the meet whose download is in flight, and stamps its access up front", async () => {
    const store = useBackedStorage({
      [MEET_CACHE_KEY]: JSON.stringify({
        totalSize: 0,
        meets: { D: { lastAccessed: 1, size: 0 } },
      }),
    });
    mockFetchApiMeetPackage.mockResolvedValue({
      meet: {},
      schedule: [],
      athletes: [buildAthlete("Athlete D")],
      meet_results: [{ name: "Athlete D" }],
      recent_results_by_name: {},
      year_bests_by_name: {},
    });
    let finishHistory!: (rows: unknown[]) => void;
    mockFetchApiResultsByNames.mockImplementationOnce(
      () => new Promise<any[]>((resolve) => { finishHistory = resolve; }),
    );

    const startedAt = Date.now();
    const download = prefetchMeetData("D" as any);
    for (let i = 0; i < 20 && !finishHistory; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(finishHistory).toBeDefined();
    const stamped = JSON.parse(store.get(MEET_CACHE_KEY) ?? "{}").meets.D.lastAccessed;
    expect(stamped).toBeGreaterThanOrEqual(startedAt);

    for (const other of ["E", "F", "G"]) {
      await prefetchCriticalMeetData(other as any);
    }

    const cleared = mockClearMeetData.mock.calls.map(([name]) => name);
    expect(cleared).not.toContain("D");

    finishHistory([]);
    await expect(download).resolves.toBeUndefined();
    expect(mockClearMeetData.mock.calls.map(([name]) => name)).not.toContain("D");
    expect(JSON.parse(store.get(MEET_CACHE_KEY) ?? "{}").meets.D).toBeDefined();
  });
});
