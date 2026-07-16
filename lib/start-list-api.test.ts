import type { SupabaseLiftResult } from "@/data/types/athletes";

const mockFetchApiYearBests = jest.fn();
const mockFetchApiYearBestsByNames = jest.fn();
const mockFetchApiResultsByNames = jest.fn();

jest.mock("@/lib/api/meetcal-api", () => ({
  fetchApiYearBests: (...args: any[]) => mockFetchApiYearBests(...args),
  fetchApiYearBestsByNames: (...args: any[]) =>
    mockFetchApiYearBestsByNames(...args),
  fetchApiResultsByNames: (...args: any[]) => mockFetchApiResultsByNames(...args),
}));

const mockGetAllCachedLiftingResultsForAthlete = jest.fn();
const mockGetCachedAthleteBestsForNames = jest.fn();
const mockSaveAthleteBestsBatch = jest.fn();

jest.mock("@/lib/database/offline-store", () => ({
  getAllCachedLiftingResultsForAthlete: (...args: any[]) =>
    mockGetAllCachedLiftingResultsForAthlete(...args),
  getCachedAthleteBestsForNames: (...args: any[]) =>
    mockGetCachedAthleteBestsForNames(...args),
  saveAthleteBestsBatch: (...args: any[]) => mockSaveAthleteBestsBatch(...args),
}));

function liftRow(overrides: Partial<SupabaseLiftResult>): SupabaseLiftResult {
  return {
    id: 0,
    event_id: "e",
    meet: "Meet",
    date: "2023-01-01",
    name: "Athlete",
    age: 25,
    body_weight: 80,
    snatch1: null,
    snatch2: null,
    snatch3: null,
    snatch_best: null,
    cj1: null,
    cj2: null,
    cj3: null,
    cj_best: null,
    total: null,
    ...overrides,
  };
}

// Fresh module (and its module-level in-memory cache) per test.
let startListApi: typeof import("@/lib/start-list-api");

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  // Sensible defaults; individual tests override as needed.
  mockGetCachedAthleteBestsForNames.mockResolvedValue({});
  mockGetAllCachedLiftingResultsForAthlete.mockResolvedValue([]);
  mockSaveAthleteBestsBatch.mockResolvedValue(undefined);
  mockFetchApiResultsByNames.mockResolvedValue([]);
  startListApi = require("@/lib/start-list-api");
});

describe("getLastYearBests", () => {
  it("returns and persists windowed bests when the athlete has recent results", async () => {
    mockFetchApiYearBests.mockResolvedValue([
      { bestSnatch: 100, bestCJ: 120, bestTotal: 220 },
    ]);

    const result = await startListApi.getLastYearBests("Recent Athlete");

    expect(result).toEqual({ bestSnatch: 100, bestCJ: 120, bestTotal: 220 });
    expect(mockFetchApiResultsByNames).not.toHaveBeenCalled();
    expect(mockSaveAthleteBestsBatch).toHaveBeenCalledWith({
      "Recent Athlete": { snatch_best: 100, cj_best: 120, total: 220 },
    });
  });

  it("falls back to the MOST RECENT meet only (not career bests) for a stale athlete", async () => {
    // Nothing inside the year window.
    mockFetchApiYearBests.mockResolvedValue([
      { bestSnatch: 0, bestCJ: 0, bestTotal: 0 },
    ]);
    // Full history: an OLDER meet has bigger numbers than the most recent one.
    mockFetchApiResultsByNames.mockResolvedValue([
      liftRow({
        name: "Stale Athlete",
        meet: "Old Big Meet",
        date: "2019-01-01",
        snatch_best: 200,
        cj_best: 240,
        total: 440,
      }),
      liftRow({
        name: "Stale Athlete",
        meet: "Recent Small Meet",
        date: "2022-06-01",
        snatch_best: 100,
        cj_best: 120,
        total: 220,
      }),
    ]);

    const result = await startListApi.getLastYearBests("Stale Athlete");

    // Derived from the recent meet only, NOT the career-best older meet.
    expect(result).toEqual({ bestSnatch: 100, bestCJ: 120, bestTotal: 220 });
    expect(mockFetchApiResultsByNames).toHaveBeenCalledTimes(1);
    expect(mockSaveAthleteBestsBatch).toHaveBeenCalledWith({
      "Stale Athlete": { snatch_best: 100, cj_best: 120, total: 220 },
    });
  });

  it("returns zeros for a never-competed athlete and never persists an all-null row", async () => {
    mockFetchApiYearBests.mockResolvedValue([
      { bestSnatch: 0, bestCJ: 0, bestTotal: 0 },
    ]);
    mockFetchApiResultsByNames.mockResolvedValue([]);

    const result = await startListApi.getLastYearBests("Never Competed");

    expect(result).toEqual({ bestSnatch: 0, bestCJ: 0, bestTotal: 0 });
    expect(mockSaveAthleteBestsBatch).not.toHaveBeenCalled();
  });

  it("skips a stored all-null bests row and re-resolves via fetch", async () => {
    mockGetCachedAthleteBestsForNames.mockResolvedValue({
      "Null Row Athlete": { snatch_best: null, cj_best: null, total: null },
    });
    mockFetchApiYearBests.mockResolvedValue([
      { bestSnatch: 90, bestCJ: 110, bestTotal: 200 },
    ]);

    const result = await startListApi.getLastYearBests("Null Row Athlete");

    expect(result).toEqual({ bestSnatch: 90, bestCJ: 110, bestTotal: 200 });
    // Proves the stored null row did not short-circuit the resolution.
    expect(mockFetchApiYearBests).toHaveBeenCalledTimes(1);
  });

  it("returns a stored real bests row without fetching", async () => {
    mockGetCachedAthleteBestsForNames.mockResolvedValue({
      "Cached Athlete": { snatch_best: 80, cj_best: 100, total: 180 },
    });

    const result = await startListApi.getLastYearBests("Cached Athlete");

    expect(result).toEqual({ bestSnatch: 80, bestCJ: 100, bestTotal: 180 });
    expect(mockFetchApiYearBests).not.toHaveBeenCalled();
  });

  it("returns zeros and does not crash when the full-history fetch throws", async () => {
    mockFetchApiYearBests.mockResolvedValue([
      { bestSnatch: 0, bestCJ: 0, bestTotal: 0 },
    ]);
    mockFetchApiResultsByNames.mockRejectedValue(new Error("network down"));

    const result = await startListApi.getLastYearBests("Erroring Athlete");

    expect(result).toEqual({ bestSnatch: 0, bestCJ: 0, bestTotal: 0 });
    expect(mockSaveAthleteBestsBatch).not.toHaveBeenCalled();
  });
});

describe("getLastYearBestsBatch", () => {
  it("resolves fresh, stale, and never-competed names with one full-history fetch", async () => {
    mockFetchApiYearBestsByNames.mockResolvedValue({
      Fresh: { bestSnatch: 100, bestCJ: 120, bestTotal: 220 },
      Stale: { bestSnatch: 0, bestCJ: 0, bestTotal: 0 },
      Never: { bestSnatch: 0, bestCJ: 0, bestTotal: 0 },
    });
    // Full history returned only for the stale athlete; never-competed has none.
    mockFetchApiResultsByNames.mockResolvedValue([
      liftRow({
        name: "Stale",
        meet: "Old Meet",
        date: "2018-01-01",
        snatch_best: 300,
        cj_best: 360,
        total: 660,
      }),
      liftRow({
        name: "Stale",
        meet: "Recent Meet",
        date: "2021-01-01",
        snatch_best: 90,
        cj_best: 110,
        total: 200,
      }),
    ]);

    const result = await startListApi.getLastYearBestsBatch([
      "Fresh",
      "Stale",
      "Never",
    ]);

    expect(result.Fresh).toEqual({ bestSnatch: 100, bestCJ: 120, bestTotal: 220 });
    // Recent meet only.
    expect(result.Stale).toEqual({ bestSnatch: 90, bestCJ: 110, bestTotal: 200 });
    expect(result.Never).toEqual({ bestSnatch: 0, bestCJ: 0, bestTotal: 0 });

    // A single batched fetch for the two empty-window names.
    expect(mockFetchApiResultsByNames).toHaveBeenCalledTimes(1);
    expect(mockFetchApiResultsByNames).toHaveBeenCalledWith(["Stale", "Never"]);

    // Persists only rows with real bests; never-competed all-null row excluded.
    expect(mockSaveAthleteBestsBatch).toHaveBeenCalledTimes(1);
    const persisted = mockSaveAthleteBestsBatch.mock.calls[0][0];
    expect(persisted).toEqual({
      Fresh: { snatch_best: 100, cj_best: 120, total: 220 },
      Stale: { snatch_best: 90, cj_best: 110, total: 200 },
    });
    expect(persisted).not.toHaveProperty("Never");
  });

  it("returns zeros for missing names without fetching when fetchMissing is false", async () => {
    const result = await startListApi.getLastYearBestsBatch(["A", "B"], {
      fetchMissing: false,
    });

    expect(result).toEqual({
      A: { bestSnatch: 0, bestCJ: 0, bestTotal: 0 },
      B: { bestSnatch: 0, bestCJ: 0, bestTotal: 0 },
    });
    expect(mockFetchApiYearBestsByNames).not.toHaveBeenCalled();
  });
});
