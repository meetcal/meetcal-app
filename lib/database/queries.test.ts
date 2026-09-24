const mockFetchApiSchedule = jest.fn();
const mockFetchApiAthletesWithSession = jest.fn();
const mockFetchApiAthletes = jest.fn();
const mockFetchApiRecentResultsByNames = jest.fn();
const mockFetchApiResultsByNames = jest.fn();
const mockFetchApiYearBestsByNames = jest.fn();
const mockSearchApi = jest.fn();

jest.mock("@/lib/api/meetcal-api", () => ({
  fetchApiSchedule: (...args: unknown[]) => mockFetchApiSchedule(...args),
  fetchApiAthletesWithSession: (...args: unknown[]) =>
    mockFetchApiAthletesWithSession(...args),
  fetchApiAthletes: (...args: unknown[]) => mockFetchApiAthletes(...args),
  fetchApiRecentResultsByNames: (...args: unknown[]) =>
    mockFetchApiRecentResultsByNames(...args),
  fetchApiResultsByNames: (...args: unknown[]) => mockFetchApiResultsByNames(...args),
  fetchApiYearBestsByNames: (...args: unknown[]) =>
    mockFetchApiYearBestsByNames(...args),
  searchApi: (...args: unknown[]) => mockSearchApi(...args),
}));

jest.mock("@/config/dev-mock-meet", () => ({
  isMockedMeet: jest.fn(async () => false),
  getMockSchedule: jest.fn(() => []),
  getMockAthletesWithSession: jest.fn(() => []),
}));

import {
  fetchAllResultsForName,
  fetchAthleteBestsForNames,
  fetchAthletesWithSession,
  fetchRecentAthleteHistoryForNames,
  fetchSchedule,
  searchAthletesByName,
} from "@/lib/database/queries";

// The facades await the dev mock-meet check before reaching the API.
const tick = async () => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("fetchSchedule", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("forwards a known meet so the API client can skip the details request", async () => {
    mockFetchApiSchedule.mockResolvedValue([]);
    const meet = { name: "Test Meet" };

    await fetchSchedule("Test Meet", meet as never);

    expect(mockFetchApiSchedule).toHaveBeenCalledWith("Test Meet", meet);
    await fetchSchedule("Test Meet");
    expect(mockFetchApiSchedule).toHaveBeenLastCalledWith("Test Meet", undefined);
  });

  it("joins an in-flight request for the same meet and releases it afterwards", async () => {
    const pending = deferred<unknown[]>();
    mockFetchApiSchedule.mockReturnValueOnce(pending.promise);

    const first = fetchSchedule("Test Meet");
    const second = fetchSchedule("Test Meet");
    await tick();
    expect(mockFetchApiSchedule).toHaveBeenCalledTimes(1);

    pending.resolve([]);
    await expect(first).resolves.toEqual([]);
    await expect(second).resolves.toEqual([]);

    mockFetchApiSchedule.mockResolvedValueOnce([]);
    await fetchSchedule("Test Meet");
    expect(mockFetchApiSchedule).toHaveBeenCalledTimes(2);
  });

  it("rethrows a failed fetch and does not keep it in flight", async () => {
    mockFetchApiSchedule.mockRejectedValueOnce(new Error("boom"));
    await expect(fetchSchedule("Test Meet")).rejects.toThrow("boom");

    mockFetchApiSchedule.mockResolvedValueOnce([]);
    await expect(fetchSchedule("Test Meet")).resolves.toEqual([]);
  });
});

describe("fetchAthletesWithSession", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("falls back to the plain roster only for a roster-wide request", async () => {
    mockFetchApiAthletesWithSession.mockRejectedValue(new Error("sessions down"));
    mockFetchApiAthletes.mockResolvedValue([{ name: "Athlete A" }]);

    await expect(fetchAthletesWithSession("Test Meet")).resolves.toEqual([
      { name: "Athlete A" },
    ]);
    expect(mockFetchApiAthletes).toHaveBeenCalledWith("Test Meet");

    // A session-scoped request has no equivalent fallback; the caller must
    // see the failure rather than a roster filtered by nothing.
    await expect(fetchAthletesWithSession("Test Meet", 1, "Red")).rejects.toThrow(
      "sessions down",
    );
    expect(mockFetchApiAthletes).toHaveBeenCalledTimes(1);
  });

  it("dedupes in-flight requests per meet/session/platform", async () => {
    const pending = deferred<unknown[]>();
    mockFetchApiAthletesWithSession.mockReturnValueOnce(pending.promise);
    mockFetchApiAthletesWithSession.mockResolvedValueOnce([]);

    const a = fetchAthletesWithSession("Test Meet", 1, "Red");
    const b = fetchAthletesWithSession("Test Meet", 1, "Red");
    const other = fetchAthletesWithSession("Test Meet", 2, "Red");
    await tick();
    expect(mockFetchApiAthletesWithSession).toHaveBeenCalledTimes(2);

    pending.resolve([{ name: "Athlete A" }]);
    await expect(a).resolves.toEqual([{ name: "Athlete A" }]);
    await expect(b).resolves.toEqual([{ name: "Athlete A" }]);
    await expect(other).resolves.toEqual([]);
  });
});

describe("history and bests facades", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("forwards names and cutoff to the recent-history endpoint", async () => {
    mockFetchApiRecentResultsByNames.mockResolvedValue([]);
    await fetchRecentAthleteHistoryForNames(["Athlete A"], "2024-09-23");
    expect(mockFetchApiRecentResultsByNames).toHaveBeenCalledWith(["Athlete A"], "2024-09-23");

    mockFetchApiResultsByNames.mockResolvedValue([]);
    await fetchAllResultsForName("Athlete A");
    expect(mockFetchApiResultsByNames).toHaveBeenCalledWith(["Athlete A"]);
  });

  it("maps year bests per requested name, nulling zero and missing values", async () => {
    mockFetchApiYearBestsByNames.mockResolvedValue({
      "Athlete A": { bestSnatch: 100, bestCJ: 0, bestTotal: 220 },
    });

    await expect(
      fetchAthleteBestsForNames(["Athlete A", "Athlete B"], "2025-09-23"),
    ).resolves.toEqual({
      "Athlete A": { snatch_best: 100, cj_best: null, total: 220 },
      "Athlete B": { snatch_best: null, cj_best: null, total: null },
    });
    expect(mockFetchApiYearBestsByNames).toHaveBeenCalledWith(
      ["Athlete A", "Athlete B"],
      "2025-09-23",
    );
  });

  it("returns suggestions from search and rethrows failures", async () => {
    mockSearchApi.mockResolvedValueOnce({ suggestions: ["Athlete A"], results: [] });
    await expect(searchAthletesByName("ath")).resolves.toEqual(["Athlete A"]);

    jest.spyOn(console, "error").mockImplementation(() => {});
    mockSearchApi.mockRejectedValueOnce(new Error("search down"));
    await expect(searchAthletesByName("ath")).rejects.toThrow("search down");
    jest.restoreAllMocks();
  });
});
