import { SyncManager } from "@/lib/database/sync-manager";

const mockSaveMeetSchedule = jest.fn(async () => undefined);
const mockFetchSchedule = jest.fn();
const mockGetCachedMeetByName = jest.fn(async (): Promise<unknown> => null);
const mockIsNetworkAvailable = jest.fn(async () => true);

jest.mock("@/lib/database/offline-store", () => ({
  saveMeetSchedule: (...args: unknown[]) => mockSaveMeetSchedule(...(args as [])),
}));
jest.mock("@/lib/database/queries", () => ({
  fetchSchedule: (...args: unknown[]) => mockFetchSchedule(...args),
}));
jest.mock("@/lib/database/meet-manager", () => ({
  getCachedMeetByName: (...args: unknown[]) => mockGetCachedMeetByName(...(args as [])),
}));
jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: () => mockIsNetworkAvailable(),
}));
jest.mock("@/lib/logger", () => ({ devLog: jest.fn() }));

const SYNC_INTERVAL_MS = 5 * 60 * 1000;

describe("SyncManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsNetworkAvailable.mockResolvedValue(true);
    mockGetCachedMeetByName.mockResolvedValue(null);
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("refreshes the schedule with the cached meet so no details request rides along", async () => {
    const cachedMeet = { name: "Test Meet" };
    mockGetCachedMeetByName.mockResolvedValue(cachedMeet);
    const schedule = [{ date: "d", fullDate: "2099-01-01", sessions: [] }];
    mockFetchSchedule.mockResolvedValue(schedule);

    await new SyncManager("Test Meet").syncIfNeeded();

    expect(mockFetchSchedule).toHaveBeenCalledWith("Test Meet", cachedMeet);
    expect(mockSaveMeetSchedule).toHaveBeenCalledWith("Test Meet", schedule);
  });

  it("does not overwrite the offline schedule with an empty response", async () => {
    mockFetchSchedule.mockResolvedValue([]);
    await new SyncManager("Test Meet").syncIfNeeded();
    expect(mockSaveMeetSchedule).not.toHaveBeenCalled();
  });

  it("does nothing while offline", async () => {
    mockIsNetworkAvailable.mockResolvedValue(false);
    await new SyncManager("Test Meet").syncIfNeeded();
    expect(mockFetchSchedule).not.toHaveBeenCalled();
  });

  it("rethrows a failed sync and clears the in-progress flag", async () => {
    mockFetchSchedule.mockRejectedValueOnce(new Error("boom"));
    const manager = new SyncManager("Test Meet");
    await expect(manager.syncIfNeeded()).rejects.toThrow("boom");

    mockFetchSchedule.mockResolvedValueOnce([]);
    await expect(manager.syncIfNeeded()).resolves.toBeUndefined();
    expect(mockFetchSchedule).toHaveBeenCalledTimes(2);
  });

  it("skips a sync while one is still running", async () => {
    let resolveFetch!: (value: unknown[]) => void;
    mockFetchSchedule.mockReturnValueOnce(
      new Promise<unknown[]>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const manager = new SyncManager("Test Meet");

    const first = manager.syncIfNeeded();
    await Promise.resolve();
    await Promise.resolve();
    await manager.syncIfNeeded();
    expect(mockFetchSchedule).toHaveBeenCalledTimes(1);

    resolveFetch([]);
    await first;
  });

  it("does not sync on construction; only start() schedules the loop, and stopSync ends it", async () => {
    jest.useFakeTimers();
    mockFetchSchedule.mockResolvedValue([]);
    const manager = new SyncManager("Test Meet");

    await jest.advanceTimersByTimeAsync(SYNC_INTERVAL_MS);
    expect(mockFetchSchedule).not.toHaveBeenCalled();

    manager.start();
    await jest.advanceTimersByTimeAsync(SYNC_INTERVAL_MS);
    expect(mockFetchSchedule).toHaveBeenCalledTimes(1);

    manager.stopSync();
    await jest.advanceTimersByTimeAsync(SYNC_INTERVAL_MS * 2);
    expect(mockFetchSchedule).toHaveBeenCalledTimes(1);
  });

  it("catches a failed periodic sync instead of leaking an unhandled rejection", async () => {
    jest.useFakeTimers();
    mockFetchSchedule.mockRejectedValue(new Error("boom"));
    const manager = new SyncManager("Test Meet");
    manager.start();

    await jest.advanceTimersByTimeAsync(SYNC_INTERVAL_MS);

    expect(console.error).toHaveBeenCalledWith("Periodic sync failed:", expect.any(Error));
    manager.stopSync();
  });
});
