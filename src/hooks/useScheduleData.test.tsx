import React from "react";
import { act, create } from "react-test-renderer";

import type { Schedule } from "@/types/schedule";
import { useScheduleData } from "@/hooks/useScheduleData";
import { useStartupScreenReport } from "@/hooks/useStartupScreenReport";
import { createStartupTiming, scheduleScreenOutcome } from "@/lib/startup-timing";
import {
  primeScheduleCache,
  resetSchedulePrimeForTests,
  scheduleResource,
} from "@/lib/database/schedule-resource";

const mockGetMeetSchedule = jest.fn<Promise<Schedule>, [string]>();
const mockSaveMeetSchedule = jest.fn<Promise<void>, [string, Schedule]>();
const mockFetchSchedule = jest.fn<Promise<Schedule>, [string]>();

jest.mock("@/lib/database/offline-store", () => ({
  getMeetSchedule: (meet: string) => mockGetMeetSchedule(meet),
  saveMeetSchedule: (meet: string, schedule: unknown) =>
    mockSaveMeetSchedule(meet, schedule as never),
  getMeetWriteGeneration: () => 0,
}));

jest.mock("@/lib/database/queries", () => ({
  fetchSchedule: (meet: string) => mockFetchSchedule(meet),
}));

jest.mock("@/lib/networkUtils", () => ({
  subscribeToNetworkChanges: jest.fn(() => () => {}),
}));

const DAY: Schedule[number] = {
  date: "June 20, 2099",
  fullDate: "2099-06-20",
  sessions: [
    {
      id: "s-1",
      number: 1,
      startTime: "10:00 AM",
      weighInTime: "8:00 AM",
      platforms: [
        { platform: "Red", weightClass: "71kg", platformStartTime: "10:00 AM" },
      ],
    },
  ],
} as unknown as Schedule[number];

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
};

let captured: ReturnType<typeof useScheduleData> | null = null;

function Harness({ meet }: { meet: string }) {
  const value = useScheduleData(meet);
  // Assigned after commit, not during render, so the test double stays
  // within the rules of hooks; every read below happens after `act`.
  React.useEffect(() => {
    captured = value;
  });
  return null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("useScheduleData", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSchedulePrimeForTests();
    captured = null;
    mockSaveMeetSchedule.mockResolvedValue(undefined);
  });

  it("paints a primed schedule from the cache without reading the store again", async () => {
    mockGetMeetSchedule.mockResolvedValue([DAY]);
    const fresh = deferred<Schedule>();
    mockFetchSchedule.mockReturnValue(fresh.promise);
    primeScheduleCache("Primed Meet");

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Harness meet="Primed Meet" />);
    });
    await flush();

    expect(captured?.schedule).toEqual([DAY]);
    expect(captured?.source).toBe("cache");
    expect(captured?.isLoading).toBe(false);
    expect(mockGetMeetSchedule).toHaveBeenCalledTimes(1);

    await act(async () => {
      fresh.resolve([DAY]);
    });
    act(() => {
      tree.unmount();
    });
  });

  it("keeps a network answer published before the primed read lands", async () => {
    const primed = deferred<Schedule>();
    mockGetMeetSchedule.mockReturnValueOnce(primed.promise);
    const NEW_DAY = { ...DAY, date: "June 21, 2099", fullDate: "2099-06-21" } as Schedule[number];
    mockFetchSchedule.mockResolvedValue([NEW_DAY]);
    mockGetMeetSchedule.mockResolvedValue([]);
    primeScheduleCache("Racing Meet");

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Harness meet="Racing Meet" />);
    });
    // Another screen's request answers while the disk read is still running.
    await act(async () => {
      await scheduleResource.revalidateWithCached(null, "Racing Meet" as never);
    });
    primed.resolve([DAY]);
    await flush();

    expect(captured?.schedule).toEqual([NEW_DAY]);
    expect(captured?.source).toBe("network");

    act(() => {
      tree.unmount();
    });
  });

  // The Schedule tab mounts before a meet is chosen. The render where the
  // meet arrives used to report "not loading, no days", which reads as
  // "No schedule yet": the launch splash came down on that frame.
  it("reports loading, not an empty schedule, on the render where a meet first arrives", async () => {
    mockGetMeetSchedule.mockResolvedValue([DAY]);
    const fresh = deferred<Schedule>();
    mockFetchSchedule.mockReturnValue(fresh.promise);
    const timing = createStartupTiming({ now: () => 0, setTimer: () => 0, clearTimer: () => undefined });
    const seen: string[] = [];
    let onLayout: (() => void) | null = null;

    function Screen({ meet }: { meet: string | null }) {
      const { schedule, isLoading, loadError, source } = useScheduleData(meet as never);
      const state = {
        onboardingShowing: false,
        // As at launch: the meet arrives with the cached meets list.
        meetsLoading: meet === null,
        resolvingStoredMeet: false,
        hasMeet: meet !== null,
        scheduleLoading: isLoading,
        changingMeet: false,
        scheduleDays: schedule.length,
        loadFailed: loadError !== null,
      };
      seen.push(scheduleScreenOutcome(state));
      const handler = useStartupScreenReport(state, source, timing);
      React.useEffect(() => {
        onLayout = handler;
      });
      return null;
    }

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Screen meet={null} />);
    });
    act(() => {
      tree.update(<Screen meet="Launch Meet" />);
    });
    await flush();

    expect(seen).not.toContain("empty-schedule");
    expect(seen.at(-1)).toBe("schedule");
    expect(timing.outcome()).toBeNull();
    act(() => onLayout?.());
    expect(timing.properties()).toMatchObject({ outcome: "schedule", schedule_cache_hit: true });

    await act(async () => {
      fresh.resolve([DAY]);
    });
    act(() => {
      tree.unmount();
    });
  });

  it("fetches the selected meet's schedule", async () => {
    mockGetMeetSchedule.mockResolvedValue([]);
    mockFetchSchedule.mockResolvedValue([DAY]);

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Harness meet="Cached Meet" />);
    });
    await flush();

    expect(mockFetchSchedule).toHaveBeenCalledWith("Cached Meet");

    act(() => {
      tree.unmount();
    });
  });

  // Regression: `persistFresh` used to call `clearMeetSchedule` for an empty
  // payload, so a single `200 []` from /meets/schedule permanently deleted a
  // schedule the user had downloaded for offline use.
  it("keeps the downloaded schedule when the API returns an empty list", async () => {
    mockGetMeetSchedule.mockResolvedValue([DAY]);
    mockFetchSchedule.mockResolvedValue([]);

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Harness meet="Empty Response Meet" />);
    });
    await flush();

    expect(mockSaveMeetSchedule).not.toHaveBeenCalled();

    act(() => {
      tree.unmount();
    });
  });

  it("persists a non-empty fresh schedule", async () => {
    mockGetMeetSchedule.mockResolvedValue([]);
    mockFetchSchedule.mockResolvedValue([DAY]);

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Harness meet="Fresh Schedule Meet" />);
    });
    await flush();

    expect(mockSaveMeetSchedule).toHaveBeenCalledWith("Fresh Schedule Meet", [
      DAY,
    ]);
    expect(captured!.schedule).toEqual([DAY]);

    act(() => {
      tree.unmount();
    });
  });

  // Regression: the hook dropped `error`, so a failed first load with
  // nothing cached rendered "No schedule yet … Check back soon!".
  it("reports a failed load when nothing is cached", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockGetMeetSchedule.mockResolvedValue([]);
    mockFetchSchedule.mockRejectedValue(new Error("Network request failed"));

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Harness meet="Failed Meet" />);
    });
    await flush();

    expect(captured!.schedule).toEqual([]);
    expect(captured!.loadError).toBe("Network request failed");
    expect(captured!.isLoading).toBe(false);

    act(() => {
      tree.unmount();
    });
    jest.restoreAllMocks();
  });

  // Regression: after an empty `200 []`, a failed retry was filed as a
  // refresh error only, so the screen kept saying "No schedule yet".
  it("reports a failed retry as a load failure after an empty answer", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockGetMeetSchedule.mockResolvedValue([]);
    mockFetchSchedule.mockResolvedValueOnce([]);

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Harness meet="Unpublished Meet" />);
    });
    await flush();
    expect(captured!.schedule).toEqual([]);
    expect(captured!.loadError).toBeNull();

    mockFetchSchedule.mockRejectedValueOnce(new Error("Network request failed"));
    await act(async () => {
      await captured!.refreshSchedule();
    });

    expect(captured!.schedule).toEqual([]);
    expect(captured!.loadError).toBe("Network request failed");

    act(() => {
      tree.unmount();
    });
    jest.restoreAllMocks();
  });

  it("keeps a cached schedule on screen and reports the failed refresh separately", async () => {
    mockGetMeetSchedule.mockResolvedValue([DAY]);
    mockFetchSchedule.mockRejectedValue(new Error("Network request failed"));

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Harness meet="Cached Failed Meet" />);
    });
    await flush();

    expect(captured!.schedule).toEqual([DAY]);
    expect(captured!.loadError).toBeNull();
    expect(captured!.refreshError).toBe("Network request failed");

    act(() => {
      tree.unmount();
    });
  });
});
