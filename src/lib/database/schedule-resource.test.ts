import type { MeetName } from "@/data/types/meet";
import type { Schedule } from "@/types/schedule";
import {
  primeScheduleCache,
  resetSchedulePrimeForTests,
  SCHEDULE_PRIME_TTL_MS,
  scheduleResource,
} from "@/lib/database/schedule-resource";

const mockGetMeetSchedule = jest.fn<Promise<Schedule>, [string]>();
const mockGenerations = new Map<string, number>();

jest.mock("@/lib/database/offline-store", () => ({
  getMeetSchedule: (meet: string) => mockGetMeetSchedule(meet),
  getMeetWriteGeneration: (meet: string) => mockGenerations.get(meet) ?? 0,
  saveMeetSchedule: jest.fn(async () => undefined),
  clearMeetSchedule: jest.fn(async () => undefined),
}));
jest.mock("@/lib/database/queries", () => ({
  fetchSchedule: jest.fn(async () => []),
}));

const MEET = "Primed Meet" as MeetName;

function day(label: string): Schedule {
  return [
    {
      date: label,
      fullDate: "2099-01-01",
      sessions: [
        {
          id: `${label}-1`,
          number: 1,
          startTime: "8:00 AM",
          weighInTime: "6:00 AM",
          platforms: [{ platform: "Red", weightClass: "Red class" }],
        },
      ],
    },
  ];
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const bumpWrites = (meet: string) => mockGenerations.set(meet, (mockGenerations.get(meet) ?? 0) + 1);

describe("schedule resource priming", () => {
  const T0 = Date.parse("2026-06-20T12:00:00.000Z");

  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
    mockGetMeetSchedule.mockReset();
    mockGenerations.clear();
    resetSchedulePrimeForTests();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("hands the cache read the schedule the launch already started reading", async () => {
    const stored = day("Primed");
    const read = deferred<Schedule>();
    mockGetMeetSchedule.mockReturnValueOnce(read.promise);

    primeScheduleCache(MEET);
    expect(mockGetMeetSchedule).toHaveBeenCalledTimes(1);

    const cached = scheduleResource.loadCached(MEET);
    read.resolve(stored);
    await expect(cached).resolves.toEqual({ data: stored, lastUpdatedAt: null });
    // No second disk read.
    expect(mockGetMeetSchedule).toHaveBeenCalledTimes(1);
  });

  it("serves every reader of the meet while the prime is current", async () => {
    mockGetMeetSchedule.mockResolvedValue(day("Primed"));
    primeScheduleCache(MEET);

    await scheduleResource.loadCached(MEET);
    await scheduleResource.loadCached(MEET);
    expect(mockGetMeetSchedule).toHaveBeenCalledTimes(1);
  });

  it("reads another meet from the store", async () => {
    mockGetMeetSchedule.mockResolvedValueOnce(day("Primed"));
    mockGetMeetSchedule.mockResolvedValueOnce(day("Other"));
    primeScheduleCache(MEET);

    const cached = await scheduleResource.loadCached("Other Meet" as MeetName);
    expect(cached?.data[0].date).toBe("Other");
    expect(mockGetMeetSchedule).toHaveBeenLastCalledWith("Other Meet");
  });

  it("does not trust a prime once the meet has been written since it started", async () => {
    mockGetMeetSchedule.mockResolvedValueOnce(day("Before the write"));
    primeScheduleCache(MEET);
    bumpWrites(MEET);
    mockGetMeetSchedule.mockResolvedValueOnce(day("After the write"));

    const cached = await scheduleResource.loadCached(MEET);
    expect(cached?.data[0].date).toBe("After the write");
    expect(mockGetMeetSchedule).toHaveBeenCalledTimes(2);
  });

  it("does not trust a prime whose read overlapped a write that began after it was handed out", async () => {
    const read = deferred<Schedule>();
    mockGetMeetSchedule.mockReturnValueOnce(read.promise);
    primeScheduleCache(MEET);

    const cached = scheduleResource.loadCached(MEET);
    // A save is queued while the primed read is still running.
    bumpWrites(MEET);
    mockGetMeetSchedule.mockResolvedValueOnce(day("After the write"));
    read.resolve(day("Before the write"));

    await expect(cached).resolves.toMatchObject({ data: day("After the write") });
  });

  it("expires after its time to live", async () => {
    mockGetMeetSchedule.mockResolvedValueOnce(day("Old prime"));
    primeScheduleCache(MEET);
    jest.setSystemTime(T0 + SCHEDULE_PRIME_TTL_MS + 1);
    mockGetMeetSchedule.mockResolvedValueOnce(day("Fresh read"));

    const cached = await scheduleResource.loadCached(MEET);
    expect(cached?.data[0].date).toBe("Fresh read");
  });

  it("falls back to the store when the primed read fails", async () => {
    mockGetMeetSchedule.mockRejectedValueOnce(new Error("read failed"));
    primeScheduleCache(MEET);
    mockGetMeetSchedule.mockResolvedValueOnce(day("Retried"));

    const cached = await scheduleResource.loadCached(MEET);
    expect(cached?.data[0].date).toBe("Retried");
  });

  it("reports no cache for a primed empty schedule, as for a stored one", async () => {
    mockGetMeetSchedule.mockResolvedValueOnce([]);
    primeScheduleCache(MEET);

    await expect(scheduleResource.loadCached(MEET)).resolves.toBeNull();
    expect(mockGetMeetSchedule).toHaveBeenCalledTimes(1);
  });
});
