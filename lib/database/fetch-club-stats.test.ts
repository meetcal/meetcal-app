import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clubAthletesResource,
  clubMeetStatsResource,
  MAX_CACHED_CLUB_ATHLETE_LISTS,
  MAX_CACHED_CLUB_MEET_STATS,
} from "@/lib/database/fetch-club-stats";
import { OFFLINE_CACHE_KEYS } from "@/lib/database/offline-cache";
const mockGetJsonArray = jest.fn();
const mockGetJsonObject = jest.fn();
const mockFetchApiClubNames = jest.fn();

jest.mock("@/lib/api/meetcal-api", () => ({
  getJsonArray: (...args: unknown[]) => mockGetJsonArray(...args),
  getJsonObject: (...args: unknown[]) => mockGetJsonObject(...args),
  fetchApiClubNames: (...args: unknown[]) => mockFetchApiClubNames(...args),
}));
jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(async () => true),
}));


const STATS_ROW = {
  total_athletes: 3,
  gold_medals: 1,
  silver_medals: 0,
  bronze_medals: 2,
  total_prs: 4,
  perfect_6_for_6: 1,
  total_weight_lifted: 1234,
};

// The real offline cache runs over the AsyncStorage mock from jest.setup.js.
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe("club stats mappers", () => {
  it("maps meet stats and tolerates a missing athlete_results section", async () => {
    mockGetJsonObject.mockResolvedValue(STATS_ROW);

    const result = await clubMeetStatsResource.revalidate("Club", "Meet");

    expect(result.data).toEqual({
      totalAthletes: 3,
      goldMedals: 1,
      silverMedals: 0,
      bronzeMedals: 2,
      totalPRs: 4,
      perfect6for6: 1,
      totalWeightLifted: 1234,
      snatchMakeRate: 0,
      cjMakeRate: 0,
      combinedMakeRate: 0,
    });
    await expect(clubMeetStatsResource.loadCached("Club", "Meet")).resolves.toEqual({
      data: result.data,
      lastUpdatedAt: result.lastUpdatedAt,
    });
  });

  it("maps athlete rows into the club athlete shape, one entry per row, without the athlete list", async () => {
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
    // No screen reads the per-athlete list, so it is not kept.
    expect(result.data).not.toHaveProperty("athleteResults");
    expect(await AsyncStorage.getItem(OFFLINE_CACHE_KEYS.clubMeetStats)).not.toContain("Athlete A");

    mockGetJsonArray.mockResolvedValue([
      { member_id: "1", name: "Athlete A", meet: "Meet", club: "Club", gender: "Men" },
    ]);
    const athletes = await clubAthletesResource.revalidate("Club");
    expect(athletes.data).toEqual([
      { member_id: "1", name: "Athlete A", meet: "Meet", club: "Club" },
    ]);
  });
});

describe("club browse caches are bounded", () => {
  it(`keeps the ${MAX_CACHED_CLUB_ATHLETE_LISTS} most recently viewed clubs' athletes`, async () => {
    mockGetJsonArray.mockResolvedValue([
      { member_id: "1", name: "Athlete A", meet: "Meet", club: "Club" },
    ]);
    for (let i = 0; i <= MAX_CACHED_CLUB_ATHLETE_LISTS; i += 1) {
      await clubAthletesResource.revalidate(`Club ${i}`);
    }
    await expect(clubAthletesResource.loadCached("Club 0")).resolves.toBeNull();
    await expect(clubAthletesResource.loadCached("Club 1")).resolves.not.toBeNull();
  });

  it(`keeps the ${MAX_CACHED_CLUB_MEET_STATS} most recently viewed meet stats`, async () => {
    mockGetJsonObject.mockResolvedValue(STATS_ROW);
    for (let i = 0; i <= MAX_CACHED_CLUB_MEET_STATS; i += 1) {
      await clubMeetStatsResource.revalidate("Club", `Meet ${i}`);
    }
    await expect(clubMeetStatsResource.loadCached("Club", "Meet 0")).resolves.toBeNull();
    await expect(clubMeetStatsResource.loadCached("Club", "Meet 1")).resolves.not.toBeNull();
  });

  it("reads a stats entry stored before the athlete list was dropped, without it", async () => {
    await AsyncStorage.setItem(
      OFFLINE_CACHE_KEYS.clubMeetStats,
      JSON.stringify({
        data: { "Club::Meet": { totalAthletes: 1, athleteResults: [{ name: "Old" }] } },
        lastSynced: 7,
      }),
    );
    await expect(clubMeetStatsResource.loadCached("Club", "Meet")).resolves.toEqual({
      data: { totalAthletes: 1 },
      lastUpdatedAt: 7,
    });
  });
});
