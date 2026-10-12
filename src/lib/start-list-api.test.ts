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
const mockGetStoredAthleteBestsForNames = jest.fn();
const mockSaveAthleteBestsBatch = jest.fn();

jest.mock("@/lib/database/offline-store", () => ({
  getAllCachedLiftingResultsForAthlete: (...args: any[]) =>
    mockGetAllCachedLiftingResultsForAthlete(...args),
  getStoredAthleteBestsForNames: (...args: any[]) =>
    mockGetStoredAthleteBestsForNames(...args),
  saveAthleteBestsBatch: (...args: any[]) => mockSaveAthleteBestsBatch(...args),
  // The real freshness rule, so the in-memory cache expires on it too.
  isAthleteBestsFresh: (...args: any[]) =>
    jest.requireActual("@/lib/database/offline-store").isAthleteBestsFresh(...args),
}));

/** A stored bests entry as `getStoredAthleteBestsForNames` reports it. */
function storedBests(
  bests: { snatch_best: number | null; cj_best: number | null; total: number | null },
  isFresh: boolean,
) {
  return { bests, fetchedAt: isFresh ? Date.now() : 0, isFresh };
}

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
  mockGetStoredAthleteBestsForNames.mockResolvedValue({});
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
    expect(mockFetchApiResultsByNames).toHaveBeenCalledWith(["Stale Athlete"], {
      latestOnly: true,
    });
    expect(mockSaveAthleteBestsBatch).toHaveBeenCalledWith({
      "Stale Athlete": { snatch_best: 100, cj_best: 120, total: 220 },
    });
  });

  it("returns zeros for a never-competed athlete and stores the API's \"no results\"", async () => {
    mockFetchApiYearBests.mockResolvedValue([
      { bestSnatch: 0, bestCJ: 0, bestTotal: 0 },
    ]);
    mockFetchApiResultsByNames.mockResolvedValue([]);

    const result = await startListApi.getLastYearBests("Never Competed");

    expect(result).toEqual({ bestSnatch: 0, bestCJ: 0, bestTotal: 0 });
    // Both lookups answered, so it is stored (under the short empty TTL).
    expect(mockSaveAthleteBestsBatch).toHaveBeenCalledWith({
      "Never Competed": { snatch_best: null, cj_best: null, total: null },
    });
  });

  it("trusts a fresh stored \"no results\" without fetching", async () => {
    mockGetStoredAthleteBestsForNames.mockResolvedValue({
      Newcomer: storedBests({ snatch_best: null, cj_best: null, total: null }, true),
    });

    const result = await startListApi.getLastYearBests("Newcomer");

    expect(result).toEqual({ bestSnatch: 0, bestCJ: 0, bestTotal: 0 });
    expect(mockFetchApiYearBests).not.toHaveBeenCalled();
  });

  it("re-resolves a stale stored all-null row via fetch", async () => {
    mockGetStoredAthleteBestsForNames.mockResolvedValue({
      "Null Row Athlete": storedBests({ snatch_best: null, cj_best: null, total: null }, false),
    });
    mockFetchApiYearBests.mockResolvedValue([
      { bestSnatch: 90, bestCJ: 110, bestTotal: 200 },
    ]);

    const result = await startListApi.getLastYearBests("Null Row Athlete");

    expect(result).toEqual({ bestSnatch: 90, bestCJ: 110, bestTotal: 200 });
    // Proves the stored null row did not short-circuit the resolution.
    expect(mockFetchApiYearBests).toHaveBeenCalledTimes(1);
  });

  it("returns a fresh stored real bests row without fetching", async () => {
    mockGetStoredAthleteBestsForNames.mockResolvedValue({
      "Cached Athlete": storedBests({ snatch_best: 80, cj_best: 100, total: 180 }, true),
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

  it("serves a stale stored answer when the lookup fails, and stores nothing", async () => {
    mockGetStoredAthleteBestsForNames.mockResolvedValue({
      "Old Athlete": storedBests({ snatch_best: 80, cj_best: 100, total: 180 }, false),
    });
    mockFetchApiYearBests.mockRejectedValue(new Error("offline"));

    const result = await startListApi.getLastYearBests("Old Athlete");

    expect(result).toEqual({ bestSnatch: 80, bestCJ: 100, bestTotal: 180 });
    expect(mockSaveAthleteBestsBatch).not.toHaveBeenCalled();
  });

  it("does not store an offline fallback derived from downloaded meets", async () => {
    mockFetchApiYearBests.mockRejectedValue(new Error("offline"));
    mockGetAllCachedLiftingResultsForAthlete.mockResolvedValue([
      liftRow({ date: "2099-01-01", snatch_best: 100, cj_best: 120, total: 220 }),
    ]);

    const result = await startListApi.getLastYearBests("Offline Athlete");

    expect(result).toEqual({ bestSnatch: 100, bestCJ: 120, bestTotal: 220 });
    expect(mockSaveAthleteBestsBatch).not.toHaveBeenCalled();
  });
});

describe("offline fallback date window", () => {
  it("compares result dates as calendar dates, keeping a result on the cutoff day", async () => {
    // `new Date("2025-09-23")` is UTC midnight; comparing via `toISOString`
    // still worked, but the pattern is the same one that drifts a day for
    // anything else and it is the only place that did not go through
    // `toMeetCalendarDate`.
    const { getHistoryCutoffDate, YEAR_BESTS_YEARS } = jest.requireActual<
      typeof import("@/utils/dateTime")
    >("@/utils/dateTime");
    const cutoff = getHistoryCutoffDate(YEAR_BESTS_YEARS);
    mockFetchApiYearBestsByNames.mockRejectedValue(new Error("offline"));
    mockFetchApiYearBests.mockRejectedValue(new Error("offline"));
    mockGetAllCachedLiftingResultsForAthlete.mockResolvedValue([
      liftRow({ date: cutoff, snatch_best: 100, cj_best: 120, total: 220 }),
      liftRow({ date: "2010-01-01", meet: "Old Meet", snatch_best: 150, cj_best: 180, total: 330 }),
      liftRow({ date: "not a date", snatch_best: 90, cj_best: 110, total: 200 }),
    ]);

    const bests = await startListApi.getLastYearBests("Athlete");

    // The cutoff-day row and the undated row are inside the window; the 2010
    // career bests are not.
    expect(bests).toEqual({ bestSnatch: 100, bestCJ: 120, bestTotal: 220 });
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
    expect(mockFetchApiResultsByNames).toHaveBeenCalledWith(["Stale", "Never"], {
      latestOnly: true,
    });

    // Every answered name is stored; never-competed as the API's "no
    // results", which expires under the short empty TTL.
    expect(mockSaveAthleteBestsBatch).toHaveBeenCalledTimes(1);
    const persisted = mockSaveAthleteBestsBatch.mock.calls[0][0];
    expect(persisted).toEqual({
      Fresh: { snatch_best: 100, cj_best: 120, total: 220 },
      Stale: { snatch_best: 90, cj_best: 110, total: 200 },
      Never: { snatch_best: null, cj_best: null, total: null },
    });
  });

  it("does not store \"no results\" when the latest-meet lookup failed", async () => {
    mockFetchApiYearBestsByNames.mockResolvedValue({
      Never: { bestSnatch: 0, bestCJ: 0, bestTotal: 0 },
    });
    mockFetchApiResultsByNames.mockRejectedValue(new Error("timed out"));

    const result = await startListApi.getLastYearBestsBatch(["Never"]);

    expect(result.Never).toEqual({ bestSnatch: 0, bestCJ: 0, bestTotal: 0 });
    expect(mockSaveAthleteBestsBatch).not.toHaveBeenCalled();
  });

  it("uses fresh stored rows, \"no results\" included, and looks stale ones up again", async () => {
    mockGetStoredAthleteBestsForNames.mockResolvedValue({
      Fresh: storedBests({ snatch_best: 100, cj_best: 120, total: 220 }, true),
      FreshEmpty: storedBests({ snatch_best: null, cj_best: null, total: null }, true),
      Stale: storedBests({ snatch_best: 50, cj_best: 60, total: 110 }, false),
    });
    mockFetchApiYearBestsByNames.mockResolvedValue({
      Stale: { bestSnatch: 55, bestCJ: 65, bestTotal: 120 },
    });

    const result = await startListApi.getLastYearBestsBatch(["Fresh", "FreshEmpty", "Stale"]);

    expect(mockFetchApiYearBestsByNames).toHaveBeenCalledWith(["Stale"], expect.any(String));
    expect(result).toEqual({
      Fresh: { bestSnatch: 100, bestCJ: 120, bestTotal: 220 },
      FreshEmpty: { bestSnatch: 0, bestCJ: 0, bestTotal: 0 },
      Stale: { bestSnatch: 55, bestCJ: 65, bestTotal: 120 },
    });
  });

  it("falls back to stale stored rows when the lookup fails", async () => {
    mockGetStoredAthleteBestsForNames.mockResolvedValue({
      Stale: storedBests({ snatch_best: 50, cj_best: 60, total: 110 }, false),
    });
    mockFetchApiYearBestsByNames.mockRejectedValue(new Error("offline"));

    const result = await startListApi.getLastYearBestsBatch(["Stale", "Unknown"]);

    // "Unknown" has no stored answer and no lookup answered for it, so it is
    // left out rather than shown as a genuine "no results".
    expect(result).toEqual({
      Stale: { bestSnatch: 50, bestCJ: 60, bestTotal: 110 },
    });
    expect(mockSaveAthleteBestsBatch).not.toHaveBeenCalled();
  });

  it("still rejects a failed lookup when there is nothing stored to fall back on", async () => {
    mockFetchApiYearBestsByNames.mockRejectedValue(new Error("offline"));

    await expect(startListApi.getLastYearBestsBatch(["Unknown"])).rejects.toThrow("offline");
  });

  it("gives the same bests from the latest_only rows as from the full history", async () => {
    mockFetchApiYearBestsByNames.mockResolvedValue({
      Stale: { bestSnatch: 0, bestCJ: 0, bestTotal: 0 },
    });
    const latestRows = [
      // Two rows on the latest date (e.g. a re-weigh listing), same meet.
      liftRow({ name: "Stale", meet: "Recent Meet", date: "2021-01-01", snatch_best: 90, cj_best: 110, total: 200 }),
      liftRow({ name: "Stale", meet: "Recent Meet", date: "2021-01-01", snatch_best: 95, cj_best: 105, total: 200 }),
    ];
    const fullHistory = [
      ...latestRows,
      liftRow({ name: "Stale", meet: "Old Meet", date: "2018-01-01", snatch_best: 300, cj_best: 360, total: 660 }),
    ];

    mockFetchApiResultsByNames.mockResolvedValue(fullHistory);
    const fromFull = await startListApi.getLastYearBestsBatch(["Stale"]);

    jest.resetModules();
    mockFetchApiResultsByNames.mockResolvedValue(latestRows);
    const fresh: typeof import("@/lib/start-list-api") = require("@/lib/start-list-api");
    const fromLatest = await fresh.getLastYearBestsBatch(["Stale"]);

    expect(fromLatest.Stale).toEqual({ bestSnatch: 95, bestCJ: 110, bestTotal: 200 });
    expect(fromLatest).toEqual(fromFull);
  });

  it("matches latest_only rows to the requested name the way the API folds names", async () => {
    mockFetchApiYearBestsByNames.mockResolvedValue({
      "Jane  Doe": { bestSnatch: 0, bestCJ: 0, bestTotal: 0 },
    });
    // The API bounds by folded name, so the latest rows may carry another
    // spelling of the same lifter than the start list asked for.
    mockFetchApiResultsByNames.mockResolvedValue([
      liftRow({ name: "jane doe", meet: "Recent Meet", date: "2022-03-01", snatch_best: 70, cj_best: 90, total: 160 }),
    ]);

    const result = await startListApi.getLastYearBestsBatch(["Jane  Doe"]);

    expect(result["Jane  Doe"]).toEqual({ bestSnatch: 70, bestCJ: 90, bestTotal: 160 });
  });

  it("matches a bests row keyed by the cleaned name to the roster's raw spelling", async () => {
    // The API trims and folds whitespace in the names it echoes back, so the
    // roster's ' Jane Doe' used to miss its own row and be stored as "—".
    mockFetchApiYearBestsByNames.mockResolvedValue({
      "Jane Doe": { bestSnatch: 80, bestCJ: 100, bestTotal: 180 },
    });

    const result = await startListApi.getLastYearBestsBatch([" Jane Doe", "jane  doe"]);

    expect(result[" Jane Doe"]).toEqual({ bestSnatch: 80, bestCJ: 100, bestTotal: 180 });
    expect(result["jane  doe"]).toEqual({ bestSnatch: 80, bestCJ: 100, bestTotal: 180 });
    expect(mockFetchApiResultsByNames).not.toHaveBeenCalled();
    expect(mockSaveAthleteBestsBatch).toHaveBeenCalledWith({
      " Jane Doe": { snatch_best: 80, cj_best: 100, total: 180 },
      "jane  doe": { snatch_best: 80, cj_best: 100, total: 180 },
    });
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

describe("in-memory bests cache bound", () => {
  it("serves a repeated name from memory without re-fetching", async () => {
    mockFetchApiYearBestsByNames.mockResolvedValue({
      A: { bestSnatch: 100, bestCJ: 120, bestTotal: 220 },
    });

    await startListApi.getLastYearBestsBatch(["A"]);
    await startListApi.getLastYearBestsBatch(["A"]);

    expect(mockFetchApiYearBestsByNames).toHaveBeenCalledTimes(1);
  });

  // The memory cache had no expiry, so a running app kept an answer past
  // the TTL its stored copy has.
  it("looks a memoized \"no results\" up again once a day has passed", async () => {
    const start = Date.UTC(2026, 9, 12, 12);
    const now = jest.spyOn(Date, "now").mockReturnValue(start);
    mockFetchApiYearBestsByNames.mockResolvedValue({
      A: { bestSnatch: 0, bestCJ: 0, bestTotal: 0 },
    });

    try {
      await startListApi.getLastYearBestsBatch(["A"]);
      now.mockReturnValue(start + 23 * 60 * 60 * 1000);
      await startListApi.getLastYearBestsBatch(["A"]);
      expect(mockFetchApiYearBestsByNames).toHaveBeenCalledTimes(1);

      now.mockReturnValue(start + 25 * 60 * 60 * 1000);
      await startListApi.getLastYearBestsBatch(["A"]);
      expect(mockFetchApiYearBestsByNames).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });

  it("expires a memoized answer read from storage with the stored entry's age", async () => {
    const start = Date.UTC(2026, 9, 12, 12);
    const now = jest.spyOn(Date, "now").mockReturnValue(start);
    const sixDaysAgo = start - 6 * 24 * 60 * 60 * 1000;
    mockGetStoredAthleteBestsForNames.mockResolvedValueOnce({
      A: {
        bests: { snatch_best: 100, cj_best: 120, total: 220 },
        fetchedAt: sixDaysAgo,
        isFresh: true,
      },
    });
    mockFetchApiYearBests.mockResolvedValue([
      { bestSnatch: 105, bestCJ: 125, bestTotal: 230 },
    ]);

    try {
      await expect(startListApi.getLastYearBests("A")).resolves.toEqual({
        bestSnatch: 100,
        bestCJ: 120,
        bestTotal: 220,
      });
      // A day and a half later the stored answer is 7.5 days old.
      now.mockReturnValue(start + 36 * 60 * 60 * 1000);
      await expect(startListApi.getLastYearBests("A")).resolves.toEqual({
        bestSnatch: 105,
        bestCJ: 125,
        bestTotal: 230,
      });
      expect(mockFetchApiYearBests).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });

  it("evicts the oldest names once the cap is exceeded", async () => {
    const limit = startListApi.YEAR_BESTS_CACHE_LIMIT;
    // One name over the cap. Every name resolves, so every one is cached.
    const names = Array.from({ length: limit + 1 }, (_, i) => `Athlete ${i}`);
    mockFetchApiYearBestsByNames.mockImplementation(
      async (requested: string[]) =>
        Object.fromEntries(
          requested.map((name) => [
            name,
            { bestSnatch: 100, bestCJ: 120, bestTotal: 220 },
          ]),
        ),
    );

    await startListApi.getLastYearBestsBatch(names);
    mockFetchApiYearBestsByNames.mockClear();

    // The most recent name is still memoized...
    await startListApi.getLastYearBestsBatch([names[names.length - 1]]);
    expect(mockFetchApiYearBestsByNames).not.toHaveBeenCalled();

    // ...while the oldest has been evicted and has to be re-resolved.
    await startListApi.getLastYearBestsBatch([names[0]]);
    expect(mockFetchApiYearBestsByNames).toHaveBeenCalledWith(
      [names[0]],
      expect.any(String),
    );
  });
});
