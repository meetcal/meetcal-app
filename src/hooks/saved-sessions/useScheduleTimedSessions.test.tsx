import React from "react";
import { act, create } from "react-test-renderer";

import { useScheduleTimedSessions } from "@/hooks/saved-sessions/useScheduleTimedSessions";
import { SyncManager } from "@/lib/database/sync-manager";
import type { SavedSession } from "@/lib/saved-sessions-store";
import type { Schedule } from "@/types/schedule";

const mockGetMeetSchedule = jest.fn<Promise<Schedule>, [string]>();
const mockFetchSchedule = jest.fn<Promise<Schedule>, [string]>();

jest.mock("@/lib/database/offline-store", () => ({
  getMeetSchedule: (meet: string) => mockGetMeetSchedule(meet),
  saveMeetSchedule: jest.fn(async () => undefined),
  clearMeetSchedule: jest.fn(async () => undefined),
  markMeetScheduleVerified: jest.fn(async () => false),
}));
jest.mock("@/lib/database/queries", () => ({
  fetchSchedule: (meet: string) => mockFetchSchedule(meet),
}));
jest.mock("@/lib/networkUtils", () => ({
  subscribeToNetworkChanges: jest.fn(() => () => {}),
  isNetworkAvailable: async () => true,
}));

const MEET = "Test Meet" as never;

function scheduleAt(startTime: string): Schedule {
  return [
    {
      date: "June 20, 2099",
      fullDate: "2099-06-20",
      sessions: [
        {
          id: "s-12",
          number: 12,
          startTime,
          weighInTime: "",
          platforms: [{ platform: "Red", weightClass: "71kg", platformStartTime: startTime }],
        },
      ],
    },
  ] as unknown as Schedule;
}

const SAVED: SavedSession[] = [
  {
    id: "Test-Meet-12-Red",
    meet: MEET,
    sessionNumber: 12,
    platform: "Red",
    weightClass: "71kg",
    startTime: "9:00 AM",
    weighInTime: "7:00 AM",
    date: "2099-06-20",
  },
];

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

let captured: SavedSession[] = [];
function Harness() {
  const value = useScheduleTimedSessions(SAVED, MEET);
  React.useEffect(() => {
    captured = value;
  });
  return null;
}

describe("useScheduleTimedSessions follows the background schedule sync (#397)", () => {
  it("moves a saved session to the start time the periodic sync fetched", async () => {
    mockGetMeetSchedule.mockResolvedValue(scheduleAt("9:00 AM"));
    mockFetchSchedule.mockResolvedValue(scheduleAt("9:00 AM"));
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<Harness />);
    });
    await flush();
    expect(captured[0].startTime).toBe("9:00 AM");

    // The meet director moves session 12; the 5-minute sync picks it up.
    mockFetchSchedule.mockResolvedValue(scheduleAt("11:00 AM"));
    await act(async () => {
      await new SyncManager(MEET).syncIfNeeded();
    });
    await flush();
    expect(captured[0].startTime).toBe("11:00 AM");

    await act(async () => {
      tree.unmount();
    });
  });
});
