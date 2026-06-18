jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
    multiSet: jest.fn(async () => undefined),
    multiGet: jest.fn(async () => []),
    multiRemove: jest.fn(async () => undefined),
  },
}));

jest.mock("@/data/meets/config", () => ({
  getMeetConfig: jest.fn(async () => ({
    time: { timeZoneIdentifier: "America/Denver" },
  })),
}));

import { fetchLiftingResultsForMeet } from "@/lib/database/queries";

const mockFetchApiLiftingResultsForMeet = jest.fn();

jest.mock("@/lib/api/meetcal-api", () => ({
  fetchApiLiftingResultsForMeet: (...args: any[]) =>
    mockFetchApiLiftingResultsForMeet(...args),
}));

describe("fetchLiftingResultsForMeet", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns meet-scoped results", async () => {
    mockFetchApiLiftingResultsForMeet.mockResolvedValue([
      { name: "Athlete A", meet: "Test Meet", total: 200 },
    ]);

    const result = await fetchLiftingResultsForMeet("Test Meet" as any, [
      "Athlete A",
    ]);

    expect(result).toBeDefined();
    expect(mockFetchApiLiftingResultsForMeet).toHaveBeenCalledTimes(1);
  });

  it("returns empty array when meet has no results", async () => {
    mockFetchApiLiftingResultsForMeet.mockResolvedValue([]);

    const result = await fetchLiftingResultsForMeet("Test Meet" as any, [
      "Athlete A",
    ]);

    expect(result).toEqual([]);
    expect(mockFetchApiLiftingResultsForMeet).toHaveBeenCalledTimes(1);
  });
});
