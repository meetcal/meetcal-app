import React from "react";
import { act, create } from "react-test-renderer";

import type { Meet, MeetName } from "@/data/types/meet";

const mockGetCachedMeets = jest.fn<Promise<Meet[]>, []>();
const mockFetchMeetsFresh = jest.fn<Promise<Meet[]>, []>();
const mockWarmMeetData = jest.fn<Promise<void>, [string]>(async () => {});
const mockPrefetchMeetData = jest.fn<Promise<void>, [string]>(async () => {});
const mockFetchApiMeetByName = jest.fn<Promise<Meet | null>, [string]>();
const mockClearExpiredDownloadedMeets = jest.fn(async () => {});
const mockReindexAppEntities = jest.fn(async () => {});

const mockSyncManagerBuilds: MeetName[] = [];
const mockSyncManagerStarts: MeetName[] = [];
const mockSyncManagerStops: MeetName[] = [];

jest.mock("@/lib/database/meet-manager", () => ({
  getCachedMeets: (...args: []) => mockGetCachedMeets(...args),
  fetchMeetsFresh: (...args: []) => mockFetchMeetsFresh(...args),
  warmMeetData: (...args: [string]) => mockWarmMeetData(...args),
  prefetchMeetData: (...args: [string]) => mockPrefetchMeetData(...args),
}));

jest.mock("@/lib/database/offline-store", () => ({
  clearExpiredDownloadedMeets: () => mockClearExpiredDownloadedMeets(),
}));

jest.mock("@/lib/api/meetcal-api", () => ({
  fetchApiMeetByName: (name: string) => mockFetchApiMeetByName(name),
}));

jest.mock("@/utils/appIntents", () => ({
  reindexAppEntities: () => mockReindexAppEntities(),
}));

let mockNetworkListener: ((isConnected: boolean) => void) | null = null;
jest.mock("@/lib/networkUtils", () => ({
  subscribeToNetworkChanges: (callback: (isConnected: boolean) => void) => {
    mockNetworkListener = callback;
    return () => {
      mockNetworkListener = null;
    };
  },
}));

jest.mock("@/lib/database/sync-manager", () => ({
  SyncManager: class {
    meetId: string;
    constructor(meetId: string) {
      this.meetId = meetId;
      mockSyncManagerBuilds.push(meetId);
    }
    start() {
      mockSyncManagerStarts.push(this.meetId);
    }
    stopSync() {
      mockSyncManagerStops.push(this.meetId);
    }
  },
}));

import {
  SelectedMeetProvider,
  useSelectedMeet,
} from "@/contexts/SelectedMeetContext";

function makeMeet(name: string): Meet {
  return {
    id: name,
    name,
    venue: {
      name: `${name} venue`,
      address: { street: "1 Main", city: "Denver", state: "CO", zip: "80202" },
    },
    time: {
      timeZone: "Mountain",
      timeZoneIdentifier: "America/Denver",
      abbreviation: "MDT",
      utcOffset: -6,
    },
    dates: { start: "2026-06-20", end: "2026-06-22" },
    status: "upcoming",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
};

let captured: ReturnType<typeof useSelectedMeet> | null = null;

function Harness() {
  captured = useSelectedMeet();
  return null;
}

describe("SelectedMeetProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSyncManagerBuilds.length = 0;
    mockSyncManagerStarts.length = 0;
    mockSyncManagerStops.length = 0;
    mockNetworkListener = null;
    captured = null;
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockGetCachedMeets.mockResolvedValue([]);
    mockFetchApiMeetByName.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Regression: the 5-minute interval, the reconnect handler and the mount
  // effect all call `loadMeets`, and nothing cancelled an earlier run. A slow
  // first run could resolve *after* a later one had already chosen a meet and
  // overwrite the selection with its own, older answer.
  it("does not let a superseded loadMeets run overwrite a newer selection", async () => {
    const slow = deferred<Meet[]>();
    mockFetchMeetsFresh
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValue([makeMeet("Newer Meet")]);

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <SelectedMeetProvider>
          <Harness />
        </SelectedMeetProvider>,
      );
    });
    await flush();

    // Run 1 is parked on fetchMeetsFresh; nothing selected yet.
    expect(captured!.selectedMeet).toBeNull();

    // A reconnect starts run 2, which finishes first and selects a meet.
    act(() => {
      mockNetworkListener?.(false);
      mockNetworkListener?.(true);
    });
    await flush();
    expect(captured!.selectedMeet).toBe("Newer Meet");

    // Run 1 finally answers with a different, older meet list.
    await act(async () => {
      slow.resolve([makeMeet("Stale Meet")]);
      await Promise.resolve();
    });
    await flush();

    expect(captured!.selectedMeet).toBe("Newer Meet");
    expect(captured!.availableMeets.map((meet) => meet.name)).toEqual([
      "Newer Meet",
    ]);

    act(() => {
      tree.unmount();
    });
  });

  // Regression: SyncManager used to start its 5-minute interval in the
  // constructor, and the constructor ran inside a setState updater. Anything
  // that re-ran the updater (StrictMode) leaked a timer nobody could stop.
  it("starts exactly one SyncManager per selected meet and stops it on unmount", async () => {
    mockFetchMeetsFresh.mockResolvedValue([makeMeet("Meet A")]);

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <React.StrictMode>
          <SelectedMeetProvider>
            <Harness />
          </SelectedMeetProvider>
        </React.StrictMode>,
      );
    });
    await flush();

    expect(captured!.selectedMeet).toBe("Meet A");
    // One manager exists, it was started, and no extra instance was built and
    // then dropped on the floor with its timer running.
    expect(mockSyncManagerBuilds).toEqual(["Meet A"]);
    expect(mockSyncManagerStarts).toEqual(["Meet A"]);
    expect(mockSyncManagerStops).toEqual([]);

    act(() => {
      tree.unmount();
    });
    expect(mockSyncManagerStops).toEqual(["Meet A"]);
  });
});
