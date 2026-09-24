const mockGetJsonArray = jest.fn();
const mockGetJsonObject = jest.fn();
const mockFetchApiClubNames = jest.fn();
const mockGetOfflineCache = jest.fn();
const mockSetOfflineCache = jest.fn();

jest.mock("@/lib/api/meetcal-api", () => ({
  getJsonArray: (...args: unknown[]) => mockGetJsonArray(...args),
  getJsonObject: (...args: unknown[]) => mockGetJsonObject(...args),
  fetchApiClubNames: (...args: unknown[]) => mockFetchApiClubNames(...args),
}));
jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(async () => true),
}));
jest.mock("@/lib/database/offline-cache", () => ({
  OFFLINE_CACHE_KEYS: {
    clubs: "@offline_cache/clubs",
    clubAthletes: "@offline_cache/club_athletes",
    clubMeetStats: "@offline_cache/club_meet_stats",
  },
  getOfflineCache: (...args: unknown[]) => mockGetOfflineCache(...args),
  setOfflineCache: (...args: unknown[]) => mockSetOfflineCache(...args),
}));

import {
  clubAthletesResource,
  clubMeetStatsResource,
} from "@/lib/database/fetch-club-stats";

describe("club stats mappers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetOfflineCache.mockImplementation(async (_key: string, data: unknown) => ({
      data,
      lastSynced: 1,
    }));
    mockGetOfflineCache.mockResolvedValue(null);
  });

  it("maps meet stats and tolerates a missing athlete_results section", async () => {
    mockGetJsonObject.mockResolvedValue({
      total_athletes: 3,
      gold_medals: 1,
      silver_medals: 0,
      bronze_medals: 2,
      total_prs: 4,
      perfect_6_for_6: 1,
      total_weight_lifted: 1234,
    });

    const result = await clubMeetStatsResource.revalidate("Club", "Meet");

    expect(result.data).toMatchObject({
      totalAthletes: 3,
      goldMedals: 1,
      bronzeMedals: 2,
      snatchMakeRate: 0,
      cjMakeRate: 0,
      combinedMakeRate: 0,
      athleteResults: [],
    });
    expect(mockSetOfflineCache).toHaveBeenCalledWith("@offline_cache/club_meet_stats", {
      "Club::Meet": result.data,
    });
  });

  it("maps athlete rows into the club athlete shape, one entry per row", async () => {
    mockGetJsonObject.mockResolvedValue({
      total_athletes: 1,
      gold_medals: 0,
      silver_medals: 0,
      bronze_medals: 0,
      total_prs: 0,
      perfect_6_for_6: 0,
      total_weight_lifted: 0,
      snatch_make_rate: 0.5,
      athlete_results: [
        {
          name: "Athlete A",
          weight_class: "89kg",
          snatch_best: 100,
          cj_best: 120,
          total: 220,
          body_weight: 88.5,
          medal: null,
          is_pr: true,
          perfect_lifts: false,
        },
      ],
    });

    const result = await clubMeetStatsResource.revalidate("Club", "Meet");
    expect(result.data.snatchMakeRate).toBe(0.5);
    expect(result.data.athleteResults).toEqual([
      expect.objectContaining({
        id: 0,
        name: "Athlete A",
        weight_class: "89kg",
        snatch_best: 100,
        cj_best: 120,
        total: 220,
        body_weight: 88.5,
        medal: undefined,
        is_pr: true,
        perfect_lifts: false,
      }),
    ]);

    mockGetJsonArray.mockResolvedValue([
      { member_id: "1", name: "Athlete A", meet: "Meet", club: "Club", gender: "Men" },
    ]);
    const athletes = await clubAthletesResource.revalidate("Club");
    expect(athletes.data).toEqual([
      { member_id: "1", name: "Athlete A", meet: "Meet", club: "Club" },
    ]);
  });
});
