import type { SupabaseBests, SupabaseLiftResult } from "@/data/types/athletes";

const mockFetchApiYearBestsByNames = jest.fn();
const mockFetchApiResultsByNames = jest.fn();

jest.mock("@/lib/api/meetcal-api", () => ({
  fetchApiYearBestsByNames: (...args: unknown[]) => mockFetchApiYearBestsByNames(...args),
  fetchApiResultsByNames: (...args: unknown[]) => mockFetchApiResultsByNames(...args),
}));

jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(async () => true),
}));

/**
 * The per-name bests store both screens share, in memory, with the real
 * freshness rule and the real key fold.
 */
const mockStore = new Map<string, { bests: SupabaseBests; fetchedAt: number }>();

jest.mock("@/lib/database/offline-store", () => {
  const actual = jest.requireActual("@/lib/database/offline-store");
  const { normalizeAthleteName } = jest.requireActual("@/lib/athletes");
  return {
    hasAnyAthleteBest: actual.hasAnyAthleteBest,
    isAthleteBestsFresh: actual.isAthleteBestsFresh,
    getAllCachedLiftingResultsForAthlete: jest.fn(async () => []),
    getAllCachedLiftingResultsForAthletes: jest.fn(async () => ({})),
    saveAthleteBestsBatch: jest.fn(async (byName: Record<string, SupabaseBests>) => {
      for (const [name, bests] of Object.entries(byName)) {
        mockStore.set(normalizeAthleteName(name), { bests, fetchedAt: Date.now() });
      }
    }),
    getStoredAthleteBestsForNames: jest.fn(async (names: string[]) => {
      const byName: Record<string, unknown> = {};
      for (const name of names) {
        const entry = mockStore.get(normalizeAthleteName(name));
        if (!entry) continue;
        byName[name] = {
          ...entry,
          isFresh: actual.isAthleteBestsFresh(entry.bests, entry.fetchedAt, Date.now()),
        };
      }
      return byName;
    }),
  };
});

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

beforeEach(() => {
  jest.resetModules();
  mockStore.clear();
  mockFetchApiYearBestsByNames.mockReset();
  mockFetchApiResultsByNames.mockReset();
});

describe("deriveRowBests", () => {
  const { deriveRowBests } = jest.requireActual<typeof import("@/lib/year-bests")>(
    "@/lib/year-bests",
  );

  it("reads a recorded total of 0 as a bomb-out, not snatch + C&J", () => {
    expect(
      deriveRowBests({ snatch_best: 80, cj1: -100, cj2: -100, cj3: -100, cj_best: 0, total: 0 }),
    ).toEqual({ snatch_best: 80, cj_best: null, total: null });
  });

  it("sums a total only for a row without one, and only from two made lifts", () => {
    expect(deriveRowBests({ snatch1: 90, snatch2: -94, cj1: 110, total: null })).toEqual({
      snatch_best: 90,
      cj_best: 110,
      total: 200,
    });
    expect(deriveRowBests({ snatch_best: 90, cj1: -110, total: null })).toEqual({
      snatch_best: 90,
      cj_best: null,
      total: null,
    });
  });
});

describe("one stored meaning for both screens (#320)", () => {
  // X last lifted 18 months ago: nothing inside the window.
  const LAST_MEET = { snatch_best: 95, cj_best: 115, total: 210 };

  beforeEach(() => {
    mockFetchApiYearBestsByNames.mockImplementation(async (names: string[]) =>
      Object.fromEntries(names.map((name) => [name, { bestSnatch: 0, bestCJ: 0, bestTotal: 0 }])),
    );
    mockFetchApiResultsByNames.mockResolvedValue([
      liftRow({ name: "Athlete X", meet: "Last Meet", date: "2025-04-01", ...LAST_MEET }),
    ]);
  });

  it.each([
    ["session details first", ["session", "startList"]],
    ["start list first", ["startList", "session"]],
  ])("%s: both show and store the most recent meet", async (_label, order) => {
    const { getAthleteBestsBatch } = require("@/lib/athlete-bests");
    const { getLastYearBests } = require("@/lib/start-list-api");
    const shown: Record<string, unknown> = {};
    for (const screen of order) {
      shown[screen] =
        screen === "session"
          ? (await getAthleteBestsBatch(["Athlete X"], "Meet"))["Athlete X"]
          : await getLastYearBests("Athlete X");
    }

    expect(shown.session).toEqual(LAST_MEET);
    expect(shown.startList).toEqual({ bestSnatch: 95, bestCJ: 115, bestTotal: 210 });
    expect(mockStore.get("athlete x")?.bests).toEqual(LAST_MEET);
    // The second screen read the first one's fresh entry.
    expect(mockFetchApiYearBestsByNames).toHaveBeenCalledTimes(1);
  });
});

describe("lookUpAthleteBests", () => {
  it("stores nothing, and rejects, when the window lookup fails", async () => {
    const { lookUpAthleteBests } = require("@/lib/year-bests");
    mockFetchApiYearBestsByNames.mockRejectedValue(new Error("offline"));

    await expect(lookUpAthleteBests(["A"])).rejects.toThrow("offline");
    expect(mockStore.size).toBe(0);
  });

  it("reports names whose most-recent-meet lookup failed, and stores only the answered ones", async () => {
    const { lookUpAthleteBests } = require("@/lib/year-bests");
    mockFetchApiYearBestsByNames.mockResolvedValue({
      A: { bestSnatch: 100, bestCJ: 120, bestTotal: 220 },
      B: { bestSnatch: 0, bestCJ: 0, bestTotal: 0 },
    });
    mockFetchApiResultsByNames.mockRejectedValue(new Error("timed out"));

    await expect(lookUpAthleteBests(["A", "B"])).resolves.toEqual({
      answered: { A: { snatch_best: 100, cj_best: 120, total: 220 } },
      unanswered: ["B"],
    });
    expect([...mockStore.keys()]).toEqual(["a"]);
  });
});
