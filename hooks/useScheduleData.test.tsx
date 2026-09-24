import React from "react";
import { act, create } from "react-test-renderer";

import type { Schedule } from "@/types/schedule";
import { useScheduleData } from "@/hooks/useScheduleData";

const mockGetMeetSchedule = jest.fn<Promise<Schedule>, [string]>();
const mockSaveMeetSchedule = jest.fn<Promise<void>, [string, Schedule]>();
const mockClearMeetSchedule = jest.fn<Promise<void>, [string]>();
const mockFetchSchedule = jest.fn<Promise<Schedule>, [string, unknown]>();
const mockGetCachedMeetByName = jest.fn<Promise<unknown>, [string]>(async () => null);

jest.mock("@/lib/database/offline-store", () => ({
  getMeetSchedule: (meet: string) => mockGetMeetSchedule(meet),
  saveMeetSchedule: (meet: string, schedule: unknown) =>
    mockSaveMeetSchedule(meet, schedule as never),
  clearMeetSchedule: (meet: string) => mockClearMeetSchedule(meet),
}));

jest.mock("@/lib/database/queries", () => ({
  fetchSchedule: (meet: string, meetDetails: unknown) =>
    mockFetchSchedule(meet, meetDetails),
}));

jest.mock("@/lib/database/meet-manager", () => ({
  getCachedMeetByName: (meet: string) => mockGetCachedMeetByName(meet),
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

describe("useScheduleData", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    captured = null;
    mockSaveMeetSchedule.mockResolvedValue(undefined);
    mockClearMeetSchedule.mockResolvedValue(undefined);
    mockGetCachedMeetByName.mockResolvedValue(null);
  });

  it("hands the cached meet to the schedule fetch so no details request rides along", async () => {
    const cachedMeet = { name: "Cached Meet" };
    mockGetCachedMeetByName.mockResolvedValue(cachedMeet);
    mockGetMeetSchedule.mockResolvedValue([]);
    mockFetchSchedule.mockResolvedValue([DAY]);

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Harness meet="Cached Meet" />);
    });
    await flush();

    expect(mockGetCachedMeetByName).toHaveBeenCalledWith("Cached Meet");
    expect(mockFetchSchedule).toHaveBeenCalledWith("Cached Meet", cachedMeet);

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

    expect(mockClearMeetSchedule).not.toHaveBeenCalled();
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
    expect(mockClearMeetSchedule).not.toHaveBeenCalled();
    expect(captured!.schedule).toEqual([DAY]);

    act(() => {
      tree.unmount();
    });
  });
});
