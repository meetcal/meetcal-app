import { getAthleteBestsBatch } from "@/components/schedule-details/athleteBests";
import { getAthleteLiftingResults } from "@/lib/database/offline-store";
import { isNetworkAvailable } from "@/lib/networkUtils";

const mockConvexQuery = jest.fn();

jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(),
}));

jest.mock("@/lib/database/offline-store", () => ({
  getAthleteLiftingResults: jest.fn(),
}));

jest.mock("@/lib/convex", () => ({
  convex: {
    query: (...args: any[]) => mockConvexQuery(...args),
  },
}));

jest.mock("@/convex/_generated/api", () => ({
  api: {
    liftingResults: {
      getByNames: "liftingResults:getByNames",
    },
  },
}));

const mockIsNetworkAvailable = isNetworkAvailable as jest.MockedFunction<
  typeof isNetworkAvailable
>;
const mockGetAthleteLiftingResults =
  getAthleteLiftingResults as jest.MockedFunction<
    typeof getAthleteLiftingResults
  >;

describe("getAthleteBestsBatch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses cached lifting results when offline", async () => {
    mockIsNetworkAvailable.mockResolvedValue(false);
    mockGetAthleteLiftingResults.mockImplementation(async (_meet, name) => {
      if (name === "Athlete A") {
        return [{ snatch_best: 100, cj_best: 120, total: 220 } as any];
      }
      return [];
    });

    const result = await getAthleteBestsBatch(
      ["Athlete A", "Athlete B"],
      "Test Meet" as any,
    );

    expect(mockConvexQuery).not.toHaveBeenCalled();
    expect(mockGetAthleteLiftingResults).toHaveBeenCalledWith(
      "Test Meet",
      "Athlete A",
    );
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
    mockConvexQuery.mockResolvedValue([
      { name: "Athlete A", snatchBest: 90, cjBest: 110, total: 200 },
    ]);
    mockGetAthleteLiftingResults.mockImplementation(async (_meet, name) => {
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
    mockConvexQuery.mockResolvedValue([
      { name: "Athlete A", snatchBest: null, cjBest: null, total: null },
    ]);
    mockGetAthleteLiftingResults.mockResolvedValue([]);

    const result = await getAthleteBestsBatch(["Athlete A"], "Test Meet" as any);

    expect(result["Athlete A"]).toEqual({
      snatch_best: null,
      cj_best: null,
      total: null,
    });
  });

  it("derives bests from attempts when *_best fields are null", async () => {
    mockIsNetworkAvailable.mockResolvedValue(false);
    mockGetAthleteLiftingResults.mockResolvedValue([
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
