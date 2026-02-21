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

const mockQuery = jest.fn();

jest.mock("@/lib/convex", () => ({
  convex: {
    query: (...args: any[]) => mockQuery(...args),
  },
}));

jest.mock("@/convex/_generated/api", () => ({
  api: {
    liftingResults: {
      getByNames: "liftingResults:getByNames",
      getByMeet: "liftingResults:getByMeet",
    },
  },
}));

describe("fetchLiftingResultsForMeet", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns meet-scoped results", async () => {
    mockQuery.mockResolvedValue([
      { name: "Athlete A", meet: "Test Meet", total: 200 },
    ]);

    const result = await fetchLiftingResultsForMeet("Test Meet" as any, [
      "Athlete A",
    ]);

    expect(result).toBeDefined();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("returns empty array when meet has no results", async () => {
    mockQuery.mockResolvedValue([]);

    const result = await fetchLiftingResultsForMeet("Test Meet" as any, [
      "Athlete A",
    ]);

    expect(result).toEqual([]);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
