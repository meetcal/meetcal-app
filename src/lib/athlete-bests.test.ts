import {
  getAthleteBestsBatch,
  getCachedAthleteBestsBatch,
} from "@/lib/athlete-bests";
import {
  getAllCachedLiftingResultsForAthletes,
  getStoredAthleteBestsForNames,
  saveAthleteBestsBatch,
  type StoredAthleteBests,
} from "@/lib/database/offline-store";
import { fetchApiResultsByNames, fetchApiYearBestsByNames } from "@/lib/api/meetcal-api";
import { isNetworkAvailable } from "@/lib/networkUtils";

jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(),
}));

jest.mock("@/lib/database/offline-store", () => ({
  getAllCachedLiftingResultsForAthletes: jest.fn(),
  getStoredAthleteBestsForNames: jest.fn(),
  hasAnyAthleteBest: jest.requireActual("@/lib/database/offline-store").hasAnyAthleteBest,
  saveAthleteBestsBatch: jest.fn(),
}));

jest.mock("@/lib/api/meetcal-api", () => ({
  fetchApiYearBestsByNames: jest.fn(),
  fetchApiResultsByNames: jest.fn(),
}));

const mockIsNetworkAvailable = isNetworkAvailable as jest.MockedFunction<
  typeof isNetworkAvailable
>;
const mockGetAllCachedLiftingResultsForAthletes =
  getAllCachedLiftingResultsForAthletes as jest.MockedFunction<
    typeof getAllCachedLiftingResultsForAthletes
  >;
const mockGetStoredAthleteBestsForNames =
  getStoredAthleteBestsForNames as jest.MockedFunction<
    typeof getStoredAthleteBestsForNames
  >;
const mockSaveAthleteBestsBatch = saveAthleteBestsBatch as jest.MockedFunction<
  typeof saveAthleteBestsBatch
>;
const mockFetchYearBests = fetchApiYearBestsByNames as jest.MockedFunction<
  typeof fetchApiYearBestsByNames
>;
const mockFetchResultsByNames = fetchApiResultsByNames as jest.MockedFunction<
  typeof fetchApiResultsByNames
>;
/** The window lookup's answer, in the API's shape (0 for none). */
const windowed = (bestSnatch: number, bestCJ: number, bestTotal: number) => ({
  bestSnatch,
  bestCJ,
  bestTotal,
});

const EMPTY = { snatch_best: null, cj_best: null, total: null };
const stored = (
  bests: StoredAthleteBests["bests"],
  isFresh: boolean,
): StoredAthleteBests => ({ bests, fetchedAt: isFresh ? Date.now() : 0, isFresh });

describe("getAthleteBestsBatch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoredAthleteBestsForNames.mockResolvedValue({});
    mockSaveAthleteBestsBatch.mockResolvedValue(undefined);
    mockGetAllCachedLiftingResultsForAthletes.mockResolvedValue({});
    mockFetchResultsByNames.mockResolvedValue([]);
  });

  it("uses fresh persisted bests before checking network", async () => {
    mockGetStoredAthleteBestsForNames.mockResolvedValue({
      "Athlete A": stored({ snatch_best: 100, cj_best: 120, total: 220 }, true),
      "Athlete B": stored(EMPTY, true),
    });

    const result = await getAthleteBestsBatch(
      ["Athlete A", "Athlete B"],
      "Test Meet" as any,
    );

    expect(mockIsNetworkAvailable).not.toHaveBeenCalled();
    expect(mockFetchYearBests).not.toHaveBeenCalled();
    expect(result).toEqual({
      "Athlete A": { snatch_best: 100, cj_best: 120, total: 220 },
      "Athlete B": { snatch_best: null, cj_best: null, total: null },
    });
  });

  it("looks a stale stored entry up again, all-null ones included", async () => {
    mockIsNetworkAvailable.mockResolvedValue(true);
    mockGetStoredAthleteBestsForNames.mockResolvedValue({
      "Athlete A": stored({ snatch_best: 100, cj_best: 120, total: 220 }, true),
      "Athlete B": stored(EMPTY, false),
    });
    mockFetchYearBests.mockResolvedValue({ "Athlete B": windowed(80, 100, 180) });

    const result = await getAthleteBestsBatch(["Athlete A", "Athlete B"], "Test Meet" as any);

    expect(mockFetchYearBests).toHaveBeenCalledWith(["Athlete B"], expect.any(String));
    expect(result["Athlete B"]).toEqual({ snatch_best: 80, cj_best: 100, total: 180 });
    expect(mockSaveAthleteBestsBatch).toHaveBeenCalledWith({
      "Athlete B": { snatch_best: 80, cj_best: 100, total: 180 },
    });
  });

  it("loads cached bests without checking network", async () => {
    mockGetStoredAthleteBestsForNames.mockResolvedValue({
      "Athlete A": stored({ snatch_best: 100, cj_best: 120, total: 220 }, false),
    });

    const result = await getCachedAthleteBestsBatch(["Athlete A", "Athlete B"]);

    expect(mockIsNetworkAvailable).not.toHaveBeenCalled();
    expect(mockFetchYearBests).not.toHaveBeenCalled();
    expect(result).toEqual({
      "Athlete A": { snatch_best: 100, cj_best: 120, total: 220 },
      "Athlete B": { snatch_best: null, cj_best: null, total: null },
    });
  });

  it("uses cached lifting results when offline, and stores none of it", async () => {
    mockIsNetworkAvailable.mockResolvedValue(false);
    mockGetAllCachedLiftingResultsForAthletes.mockResolvedValue({
      "Athlete A": [{ snatch_best: 100, cj_best: 120, total: 220 } as any],
      "Athlete B": [],
    });

    const result = await getAthleteBestsBatch(
      ["Athlete A", "Athlete B"],
      "Test Meet" as any,
    );

    expect(mockFetchYearBests).not.toHaveBeenCalled();
    // One pass over the cached meets for the whole session, not one per athlete.
    expect(mockGetAllCachedLiftingResultsForAthletes).toHaveBeenCalledTimes(1);
    expect(mockGetAllCachedLiftingResultsForAthletes).toHaveBeenCalledWith([
      "Athlete A",
      "Athlete B",
    ]);
    expect(result["Athlete A"]).toEqual({
      snatch_best: 100,
      cj_best: 120,
      total: 220,
    });
    expect(result["Athlete B"]).toEqual({
      snatch_best: null,
      cj_best: null,
      total: null,
    });
    // An offline fallback is not an answer: stored, it read as "no results"
    // for good, even once the device was back online.
    expect(mockSaveAthleteBestsBatch).not.toHaveBeenCalled();
  });

  it("keeps a stale stored answer over the offline fallback", async () => {
    mockIsNetworkAvailable.mockResolvedValue(false);
    mockGetStoredAthleteBestsForNames.mockResolvedValue({
      "Athlete A": stored({ snatch_best: 100, cj_best: 120, total: 220 }, false),
    });
    mockGetAllCachedLiftingResultsForAthletes.mockResolvedValue({ "Athlete A": [] });

    const result = await getAthleteBestsBatch(["Athlete A"], "Test Meet" as any);

    expect(result["Athlete A"]).toEqual({ snatch_best: 100, cj_best: 120, total: 220 });
    expect(mockSaveAthleteBestsBatch).not.toHaveBeenCalled();
  });

  it("stores nothing when the request fails or times out", async () => {
    mockIsNetworkAvailable.mockResolvedValue(true);
    mockFetchYearBests.mockRejectedValue(new Error("timed out"));
    mockGetAllCachedLiftingResultsForAthletes.mockResolvedValue({
      "Athlete A": [{ snatch_best: 90, cj_best: 110, total: 200 } as any],
    });

    const result = await getAthleteBestsBatch(["Athlete A", "Athlete B"], "Test Meet" as any);

    expect(result).toEqual({
      "Athlete A": { snatch_best: 90, cj_best: 110, total: 200 },
      "Athlete B": EMPTY,
    });
    expect(mockSaveAthleteBestsBatch).not.toHaveBeenCalled();
  });

  it("stores the API's answer, \"no results\" included", async () => {
    mockIsNetworkAvailable.mockResolvedValue(true);
    mockFetchYearBests.mockResolvedValue({
      "Athlete A": windowed(90, 110, 200),
      "Athlete B": windowed(0, 0, 0),
    });

    await getAthleteBestsBatch(["Athlete A", "Athlete B"], "Test Meet" as any);

    expect(mockSaveAthleteBestsBatch).toHaveBeenCalledWith({
      "Athlete A": { snatch_best: 90, cj_best: 110, total: 200 },
      "Athlete B": EMPTY,
    });
  });

  it("still returns the fetched bests when storing them fails", async () => {
    mockIsNetworkAvailable.mockResolvedValue(true);
    mockFetchYearBests.mockResolvedValue({ "Athlete A": windowed(90, 110, 200) });
    mockSaveAthleteBestsBatch.mockRejectedValue(new Error("SQLITE_FULL"));

    const result = await getAthleteBestsBatch(["Athlete A"], "Test Meet" as any);

    expect(result["Athlete A"]).toEqual({ snatch_best: 90, cj_best: 110, total: 200 });
  });

  it("falls back to the most recent meet for nothing in the window, as the start list does", async () => {
    // #320: this used to store bests from any downloaded meet (or all-null),
    // while the start list stored the most recent meet under the same entry.
    mockIsNetworkAvailable.mockResolvedValue(true);
    mockFetchYearBests.mockResolvedValue({
      "Athlete A": windowed(90, 110, 200),
      "Athlete B": windowed(0, 0, 0),
    });
    mockFetchResultsByNames.mockResolvedValue([
      { name: "Athlete B", meet: "Last", date: "2022-01-01", snatch_best: 95, cj_best: 115, total: 210 } as any,
    ]);
    mockGetAllCachedLiftingResultsForAthletes.mockResolvedValue({
      "Athlete B": [{ snatch_best: 150, cj_best: 180, total: 330 } as any],
    });

    const result = await getAthleteBestsBatch(["Athlete A", "Athlete B"], "Test Meet" as any);

    expect(mockFetchResultsByNames).toHaveBeenCalledWith(["Athlete B"], { latestOnly: true });
    expect(mockGetAllCachedLiftingResultsForAthletes).not.toHaveBeenCalled();
    expect(result).toEqual({
      "Athlete A": { snatch_best: 90, cj_best: 110, total: 200 },
      "Athlete B": { snatch_best: 95, cj_best: 115, total: 210 },
    });
    expect(mockSaveAthleteBestsBatch).toHaveBeenCalledWith(result);
  });

  it("shows the downloaded meets, and stores nothing, when the most-recent-meet lookup fails", async () => {
    mockIsNetworkAvailable.mockResolvedValue(true);
    mockFetchYearBests.mockResolvedValue({ "Athlete B": windowed(0, 0, 0) });
    mockFetchResultsByNames.mockRejectedValue(new Error("timed out"));
    mockGetAllCachedLiftingResultsForAthletes.mockResolvedValue({
      "Athlete B": [{ snatch_best: 95, cj_best: 115, total: 210 } as any],
    });

    const result = await getAthleteBestsBatch(["Athlete B"], "Test Meet" as any);

    expect(result["Athlete B"]).toEqual({ snatch_best: 95, cj_best: 115, total: 210 });
    expect(mockSaveAthleteBestsBatch).not.toHaveBeenCalled();
  });

  it("keeps nullable bests when no real values exist", async () => {
    mockIsNetworkAvailable.mockResolvedValue(true);
    mockFetchYearBests.mockResolvedValue({ "Athlete A": windowed(0, 0, 0) });

    const result = await getAthleteBestsBatch(["Athlete A"], "Test Meet" as any);

    expect(result["Athlete A"]).toEqual(EMPTY);
  });

  it("shows no total for a downloaded bomb-out", async () => {
    // #275: total 0 is a bomb-out. It only gets a summed total when the row
    // has none at all.
    mockIsNetworkAvailable.mockResolvedValue(false);
    mockGetAllCachedLiftingResultsForAthletes.mockResolvedValue({
      "Athlete A": [
        { snatch_best: 80, cj_best: 0, cj1: -100, cj2: -100, cj3: -100, total: 0 } as any,
      ],
    });

    const result = await getAthleteBestsBatch(["Athlete A"], "Test Meet" as any);

    expect(result["Athlete A"]).toEqual({ snatch_best: 80, cj_best: null, total: null });
  });

  it("derives bests from attempts when *_best fields are null", async () => {
    mockIsNetworkAvailable.mockResolvedValue(false);
    mockGetAllCachedLiftingResultsForAthletes.mockResolvedValue({
      "Athlete A": [
        {
          snatch_best: null,
          cj_best: null,
          total: null,
          snatch1: 90,
          snatch2: -94,
          snatch3: 96,
          cj1: 110,
          cj2: 114,
          cj3: -117,
        } as any,
      ],
    });

    const result = await getAthleteBestsBatch(["Athlete A"], "Test Meet" as any);

    expect(result["Athlete A"]).toEqual({
      snatch_best: 96,
      cj_best: 114,
      total: 210,
    });
  });
});
