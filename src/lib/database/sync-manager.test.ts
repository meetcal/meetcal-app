import { AppState, type AppStateStatus } from "react-native";
import { SyncManager } from "@/lib/database/sync-manager";
import { scheduleResource } from "@/lib/database/schedule-resource";

const mockSaveMeetSchedule = jest.fn(async () => undefined);
const mockGetMeetSchedule = jest.fn(async (): Promise<unknown[]> => []);
const mockFetchSchedule = jest.fn();
const mockMarkVerified = jest.fn(async () => true);
const mockIsNetworkAvailable = jest.fn(async () => true);

jest.mock("@/lib/database/offline-store", () => ({
  saveMeetSchedule: (...args: unknown[]) => mockSaveMeetSchedule(...(args as [])),
  getMeetSchedule: () => mockGetMeetSchedule(),
  clearMeetSchedule: jest.fn(async () => undefined),
  markMeetScheduleVerified: (...args: unknown[]) => mockMarkVerified(...(args as [])),
}));
jest.mock("@/lib/database/queries", () => ({
  fetchSchedule: (...args: unknown[]) => mockFetchSchedule(...args),
}));
jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: () => mockIsNetworkAvailable(),
}));
jest.mock("@/lib/logger", () => ({ devLog: jest.fn() }));

const SYNC_INTERVAL_MS = 5 * 60 * 1000;

describe("SyncManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMeetSchedule.mockResolvedValue([]);
    mockIsNetworkAvailable.mockResolvedValue(true);
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("refreshes and saves the schedule", async () => {
    const schedule = [{ date: "d", fullDate: "2099-01-01", sessions: [] }];
    mockFetchSchedule.mockResolvedValue(schedule);

    await new SyncManager("Test Meet").syncIfNeeded();

    expect(mockFetchSchedule).toHaveBeenCalledWith("Test Meet");
    expect(mockSaveMeetSchedule).toHaveBeenCalledWith("Test Meet", schedule);
  });

  it("does not overwrite the offline schedule with an empty response", async () => {
    mockFetchSchedule.mockResolvedValue([]);
    await new SyncManager("Test Meet").syncIfNeeded();
    expect(mockSaveMeetSchedule).not.toHaveBeenCalled();
  });

  it("does not rewrite an unchanged schedule, but records that it was checked", async () => {
    const schedule = [{ date: "d", fullDate: "2099-01-01", sessions: [] }];
    mockGetMeetSchedule.mockResolvedValue(schedule);
    mockFetchSchedule.mockResolvedValue(schedule);
    await new SyncManager("Test Meet").syncIfNeeded();
    expect(mockSaveMeetSchedule).not.toHaveBeenCalled();
    expect(mockMarkVerified).toHaveBeenCalledWith("Test Meet");
  });

  it("leaves the sync stamp to the save when the schedule changed", async () => {
    mockGetMeetSchedule.mockResolvedValue([]);
    mockFetchSchedule.mockResolvedValue([{ date: "d", fullDate: "2099-01-01", sessions: [] }]);
    await new SyncManager("Test Meet").syncIfNeeded();
    expect(mockSaveMeetSchedule).toHaveBeenCalled();
    expect(mockMarkVerified).not.toHaveBeenCalled();
  });

  it("hands a changed schedule to every screen subscribed to it (#397)", async () => {
    const before = [{ date: "d", fullDate: "2099-01-01", sessions: [{ number: 12, startTime: "9:00 AM" }] }];
    const after = [{ date: "d", fullDate: "2099-01-01", sessions: [{ number: 12, startTime: "11:00 AM" }] }];
    mockGetMeetSchedule.mockResolvedValue(before);
    mockFetchSchedule.mockResolvedValue(after);
    const seen: unknown[] = [];
    const unsubscribe = scheduleResource.subscribe(scheduleResource.getKey("Test Meet"), (result) => {
      seen.push(result.data);
    });
    await new SyncManager("Test Meet").syncIfNeeded();
    unsubscribe();
    expect(seen).toEqual([after]);
  });

  it("does not hand an empty schedule to the screens showing one", async () => {
    mockGetMeetSchedule.mockResolvedValue([{ date: "d", fullDate: "2099-01-01", sessions: [] }]);
    mockFetchSchedule.mockResolvedValue([]);
    const listener = jest.fn();
    const unsubscribe = scheduleResource.subscribe(scheduleResource.getKey("Test Meet"), listener);
    await new SyncManager("Test Meet").syncIfNeeded();
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });

  it("skips an interval tick that a foreground sync already covered", async () => {
    jest.useFakeTimers();
    let listener: ((state: AppStateStatus) => void) | null = null;
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
      listener = handler as (state: AppStateStatus) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
    mockFetchSchedule.mockResolvedValue([]);
    const manager = new SyncManager("Test Meet");
    manager.start();
    try {
      // Four minutes in, the app comes back and syncs.
      await jest.advanceTimersByTimeAsync(4 * 60 * 1000);
      listener!("active");
      await jest.advanceTimersByTimeAsync(0);
      expect(mockFetchSchedule).toHaveBeenCalledTimes(1);

      // The tick a minute later is not due; the one after it is.
      await jest.advanceTimersByTimeAsync(60 * 1000);
      expect(mockFetchSchedule).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(SYNC_INTERVAL_MS);
      expect(mockFetchSchedule).toHaveBeenCalledTimes(2);
      // Back-to-back ticks keep firing every interval.
      await jest.advanceTimersByTimeAsync(SYNC_INTERVAL_MS);
      expect(mockFetchSchedule).toHaveBeenCalledTimes(3);
    } finally {
      manager.stopSync();
    }
  });

  it("retries on the next foreground after a failed fetch", async () => {
    let listener: ((state: AppStateStatus) => void) | null = null;
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
      listener = handler as (state: AppStateStatus) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
    let now = Date.UTC(2026, 9, 12, 12);
    jest.spyOn(Date, "now").mockImplementation(() => now);
    mockFetchSchedule.mockRejectedValueOnce(new Error("timeout")).mockResolvedValue([]);
    const manager = new SyncManager("Test Meet");
    manager.start();
    try {
      listener!("active");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mockFetchSchedule).toHaveBeenCalledTimes(1);

      // A minute later, back from the background: the failure did not count.
      now += 60_000;
      listener!("background");
      listener!("active");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mockFetchSchedule).toHaveBeenCalledTimes(2);
    } finally {
      manager.stopSync();
    }
  });

  it("syncs on returning to the foreground once the last sync is an interval old", async () => {
    let listener: ((state: AppStateStatus) => void) | null = null;
    const remove = jest.fn();
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
      listener = handler as (state: AppStateStatus) => void;
      return { remove } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
    let now = Date.UTC(2026, 9, 12, 12);
    jest.spyOn(Date, "now").mockImplementation(() => now);
    mockFetchSchedule.mockResolvedValue([]);
    const manager = new SyncManager("Test Meet");
    manager.start();

    // Never synced yet: the first foreground syncs.
    listener!("active");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockFetchSchedule).toHaveBeenCalledTimes(1);

    now += SYNC_INTERVAL_MS - 1;
    listener!("active");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockFetchSchedule).toHaveBeenCalledTimes(1);

    now += 1;
    listener!("background");
    listener!("active");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockFetchSchedule).toHaveBeenCalledTimes(2);

    manager.stopSync();
    expect(remove).toHaveBeenCalled();
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
