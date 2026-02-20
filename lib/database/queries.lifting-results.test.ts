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

import { supabase } from "@/lib/supabase";
import { fetchLiftingResultsForMeet } from "@/lib/database/queries";

jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: jest.fn(),
  },
}));

const mockSupabaseFrom = supabase.from as jest.Mock;

function createPrimaryChain(result: { data: any[] | null; error: any }) {
  const chain: Record<string, any> = {
    select: jest.fn(() => chain),
    in: jest.fn(() => chain),
    order: jest.fn().mockResolvedValue(result),
  };
  return chain;
}

function createFallbackChain(result: { data: any[] | null; error: any }) {
  const chain: Record<string, any> = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    order: jest.fn().mockResolvedValue(result),
  };
  return chain;
}

describe("fetchLiftingResultsForMeet", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns name-based results when present", async () => {
    const primary = createPrimaryChain({
      data: [{ name: "Athlete A", total: 200 }],
      error: null,
    });
    mockSupabaseFrom.mockReturnValue(primary);

    const result = await fetchLiftingResultsForMeet("Test Meet" as any, [
      "Athlete A",
    ]);

    expect(result).toEqual([{ name: "Athlete A", total: 200 }]);
    expect(mockSupabaseFrom).toHaveBeenCalledTimes(1);
  });

  it("falls back to meet query when name-based results are empty", async () => {
    const primary = createPrimaryChain({ data: [], error: null });
    const fallback = createFallbackChain({
      data: [{ name: "Athlete A", meet: "Test Meet", total: 200 }],
      error: null,
    });
    mockSupabaseFrom
      .mockReturnValueOnce(primary)
      .mockReturnValueOnce(fallback);

    const result = await fetchLiftingResultsForMeet("Test Meet" as any, [
      "Athlete A",
    ]);

    expect(result).toEqual([{ name: "Athlete A", meet: "Test Meet", total: 200 }]);
    expect(mockSupabaseFrom).toHaveBeenCalledTimes(2);
  });
});
