import { getAthleteBestsBatch } from "@/components/schedule-details/athleteBests";
import { getAllCachedLiftingResultsForAthlete } from "@/lib/database/offline-store";
import { fetchAthleteHistoryForNames } from "@/lib/database/queries";
import { isNetworkAvailable } from "@/lib/networkUtils";

jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(),
}));

jest.mock("@/lib/database/offline-store", () => ({
  getAllCachedLiftingResultsForAthlete: jest.fn(),
}));

jest.mock("@/lib/database/queries", () => ({
  fetchAthleteHistoryForNames: jest.fn(),
}));

const mockIsNetworkAvailable = isNetworkAvailable as jest.MockedFunction<
  typeof isNetworkAvailable
>;
const mockGetAllCachedLiftingResultsForAthlete =
  getAllCachedLiftingResultsForAthlete as jest.MockedFunction<
    typeof getAllCachedLiftingResultsForAthlete
  >;
const mockFetchAthleteHistoryForNames =
  fetchAthleteHistoryForNames as jest.MockedFunction<
    typeof fetchAthleteHistoryForNames
  >;

describe("getAthleteBestsBatch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

    expect(mockFetchAthleteHistoryForNames).not.toHaveBeenCalled();
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
    mockFetchAthleteHistoryForNames.mockResolvedValue({
      "Athlete A": [
        {
          name: "Athlete A",
          snatch_best: 90,
          cj_best: 110,
          total: 200,
        } as any,
      ],
      "Athlete B": [],
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
    mockFetchAthleteHistoryForNames.mockResolvedValue({
      "Athlete A": [
        {
          name: "Athlete A",
          snatch_best: null,
          cj_best: null,
          total: null,
        } as any,
      ],
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
