import {
  getAthleteBestsBatch,
  getCachedAthleteBestsBatch,
} from "@/components/schedule-details/athleteBests";
import {
  getAllCachedLiftingResultsForAthlete,
  getCachedAthleteBestsForNames,
  saveAthleteBestsBatch,
} from "@/lib/database/offline-store";
import { fetchAthleteBestsForNames } from "@/lib/database/queries";
import { isNetworkAvailable } from "@/lib/networkUtils";

jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(),
}));

jest.mock("@/lib/database/offline-store", () => ({
  getAllCachedLiftingResultsForAthlete: jest.fn(),
  getCachedAthleteBestsForNames: jest.fn(),
  saveAthleteBestsBatch: jest.fn(),
}));

jest.mock("@/lib/database/queries", () => ({
  fetchAthleteBestsForNames: jest.fn(),
}));

const mockIsNetworkAvailable = isNetworkAvailable as jest.MockedFunction<
  typeof isNetworkAvailable
>;
const mockGetAllCachedLiftingResultsForAthlete =
  getAllCachedLiftingResultsForAthlete as jest.MockedFunction<
    typeof getAllCachedLiftingResultsForAthlete
  >;
const mockGetCachedAthleteBestsForNames =
  getCachedAthleteBestsForNames as jest.MockedFunction<
    typeof getCachedAthleteBestsForNames
  >;
const mockSaveAthleteBestsBatch = saveAthleteBestsBatch as jest.MockedFunction<
  typeof saveAthleteBestsBatch
>;
const mockFetchAthleteBestsForNames =
  fetchAthleteBestsForNames as jest.MockedFunction<
    typeof fetchAthleteBestsForNames
  >;

describe("getAthleteBestsBatch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCachedAthleteBestsForNames.mockResolvedValue({});
    mockSaveAthleteBestsBatch.mockResolvedValue(undefined);
  });

  it("uses persisted bests before checking network", async () => {
    mockGetCachedAthleteBestsForNames.mockResolvedValue({
      "Athlete A": { snatch_best: 100, cj_best: 120, total: 220 },
      "Athlete B": { snatch_best: null, cj_best: null, total: null },
    });

    const result = await getAthleteBestsBatch(
      ["Athlete A", "Athlete B"],
      "Test Meet" as any,
    );

    expect(mockIsNetworkAvailable).not.toHaveBeenCalled();
    expect(mockFetchAthleteBestsForNames).not.toHaveBeenCalled();
    expect(result).toEqual({
      "Athlete A": { snatch_best: 100, cj_best: 120, total: 220 },
      "Athlete B": { snatch_best: null, cj_best: null, total: null },
    });
  });

  it("loads cached bests without checking network", async () => {
    mockGetCachedAthleteBestsForNames.mockResolvedValue({
      "Athlete A": { snatch_best: 100, cj_best: 120, total: 220 },
    });

    const result = await getCachedAthleteBestsBatch(["Athlete A", "Athlete B"]);

    expect(mockIsNetworkAvailable).not.toHaveBeenCalled();
    expect(mockFetchAthleteBestsForNames).not.toHaveBeenCalled();
    expect(result).toEqual({
      "Athlete A": { snatch_best: 100, cj_best: 120, total: 220 },
      "Athlete B": { snatch_best: null, cj_best: null, total: null },
    });
  });

  it("uses cached lifting results when offline", async () => {
    mockIsNetworkAvailable.mockResolvedValue(false);
    mockGetAllCachedLiftingResultsForAthlete.mockImplementation(async (name) => {
      if (name === "Athlete A") {
        return [{ snatch_best: 100, cj_best: 120, total: 220 } as any];
      }
      return [];
    });

    const result = await getAthleteBestsBatch(
      ["Athlete A", "Athlete B"],
      "Test Meet" as any,
    );

    expect(mockFetchAthleteBestsForNames).not.toHaveBeenCalled();
    expect(mockGetAllCachedLiftingResultsForAthlete).toHaveBeenCalledWith("Athlete A");
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
  });

  it("fills missing online athletes from cache", async () => {
    mockIsNetworkAvailable.mockResolvedValue(true);
    mockFetchAthleteBestsForNames.mockResolvedValue({
      "Athlete A": {
        snatch_best: 90,
        cj_best: 110,
        total: 200,
      },
      "Athlete B": {
        snatch_best: null,
        cj_best: null,
        total: null,
      },
    });
    mockGetAllCachedLiftingResultsForAthlete.mockImplementation(async (name) => {
      if (name === "Athlete B") {
        return [{ snatch_best: 95, cj_best: 115, total: 210 } as any];
      }
      return [];
    });

    const result = await getAthleteBestsBatch(
      ["Athlete A", "Athlete B"],
      "Test Meet" as any,
    );

    expect(result["Athlete A"]).toEqual({
      snatch_best: 90,
      cj_best: 110,
      total: 200,
    });
    expect(result["Athlete B"]).toEqual({
      snatch_best: 95,
      cj_best: 115,
      total: 210,
    });
  });

  it("keeps nullable bests when no real values exist", async () => {
    mockIsNetworkAvailable.mockResolvedValue(true);
    mockFetchAthleteBestsForNames.mockResolvedValue({
      "Athlete A": {
        snatch_best: null,
        cj_best: null,
        total: null,
      },
    });
    mockGetAllCachedLiftingResultsForAthlete.mockResolvedValue([]);

    const result = await getAthleteBestsBatch(["Athlete A"], "Test Meet" as any);

    expect(result["Athlete A"]).toEqual({
      snatch_best: null,
      cj_best: null,
      total: null,
    });
  });

  it("derives bests from attempts when *_best fields are null", async () => {
    mockIsNetworkAvailable.mockResolvedValue(false);
    mockGetAllCachedLiftingResultsForAthlete.mockResolvedValue([
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
    ]);

    const result = await getAthleteBestsBatch(["Athlete A"], "Test Meet" as any);

    expect(result["Athlete A"]).toEqual({
      snatch_best: 96,
      cj_best: 114,
      total: 210,
    });
  });
});
