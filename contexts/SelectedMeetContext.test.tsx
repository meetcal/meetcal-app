import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, create } from "react-test-renderer";

import type { Meet, MeetName } from "@/data/types/meet";
import {
  RECONNECT_REFETCH_JITTER_MAX_MS,
  SelectedMeetProvider,
  useSelectedMeet,
} from "@/contexts/SelectedMeetContext";

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
  const value = useSelectedMeet();
  // Assigned after commit, not during render, so the test double stays
  // within the rules of hooks; every read below happens after `act`.
  React.useEffect(() => {
    captured = value;
  });
  return null;
}

/** Fires any reconnect refetch parked behind its random jitter. */
const passReconnectJitter = () => {
  act(() => {
    jest.advanceTimersByTime(RECONNECT_REFETCH_JITTER_MAX_MS);
  });
};

describe("SelectedMeetProvider", () => {
  beforeEach(() => {
    jest.useFakeTimers();
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
    jest.useRealTimers();
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
    passReconnectJitter();
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

  // Regression: the provider value was an object literal and the three
  // actions were plain closures, so every consumer re-rendered whenever the
  // tree above the provider did, and anything keyed on `setSelectedMeet`
  // (effect deps, memoised rows) never settled.
  it("keeps the context value identity across unrelated re-renders", async () => {
    mockFetchMeetsFresh.mockResolvedValue([makeMeet("Meet A")]);

    let rerender: () => void = () => {};
    function Parent() {
      const [, setTick] = React.useState(0);
      React.useEffect(() => {
        rerender = () => setTick((t) => t + 1);
      }, []);
      return (
        <SelectedMeetProvider>
          <Harness />
        </SelectedMeetProvider>
      );
    }

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Parent />);
    });
    await flush();
    expect(captured!.selectedMeet).toBe("Meet A");

    const settled = captured!;
    act(() => {
      rerender();
    });
    act(() => {
      rerender();
    });

    expect(captured).toBe(settled);
    expect(captured!.setSelectedMeet).toBe(settled.setSelectedMeet);
    expect(captured!.forceSync).toBe(settled.forceSync);
    expect(captured!.refreshAvailableMeets).toBe(settled.refreshAvailableMeets);

    act(() => {
      tree.unmount();
    });
  });

  // Regression: every reconnect edge refetched `/meets` immediately, so a
  // flapping connection produced a burst of identical requests.
  it("coalesces flapping reconnect edges into one jittered refetch", async () => {
    mockFetchMeetsFresh.mockResolvedValue([makeMeet("Meet A")]);

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <SelectedMeetProvider>
          <Harness />
        </SelectedMeetProvider>,
      );
    });
    await flush();
    expect(captured!.selectedMeet).toBe("Meet A");
    // Mount runs `loadMeets` once, and selecting the meet re-creates it and
    // runs it once more (see the comment on `meetDetailsRef`). Everything
    // below is relative to that settled baseline.
    const baseline = mockFetchMeetsFresh.mock.calls.length;

    act(() => {
      for (let i = 0; i < 4; i += 1) {
        mockNetworkListener?.(false);
        mockNetworkListener?.(true);
      }
    });
    // Nothing fires on the edge itself.
    expect(mockFetchMeetsFresh).toHaveBeenCalledTimes(baseline);

    passReconnectJitter();
    await flush();
    expect(mockFetchMeetsFresh).toHaveBeenCalledTimes(baseline + 1);

    // Once that refetch has finished, the next reconnect schedules another.
    act(() => {
      mockNetworkListener?.(false);
      mockNetworkListener?.(true);
    });
    passReconnectJitter();
    await flush();
    expect(mockFetchMeetsFresh).toHaveBeenCalledTimes(baseline + 2);

    act(() => {
      tree.unmount();
    });
  });
});

describe("SelectedMeetProvider persisted selection", () => {
  const SELECTED_MEET_KEY = "@selected_meet";
  const SELECTED_MEET_DETAILS_KEY = "@selected_meet_details";

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    captured = null;
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    await AsyncStorage.clear();
    mockGetCachedMeets.mockResolvedValue([makeMeet("Window Meet")]);
    mockFetchApiMeetByName.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  async function mount() {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <SelectedMeetProvider>
          <Harness />
        </SelectedMeetProvider>,
      );
    });
    await flush();
    await flush();
    return tree;
  }

  it("rehydrates an out-of-window selection from its persisted details on an offline cold start", async () => {
    const outOfWindow = makeMeet("Archived Meet");
    await AsyncStorage.setItem(SELECTED_MEET_KEY, "Archived Meet");
    await AsyncStorage.setItem(SELECTED_MEET_DETAILS_KEY, JSON.stringify(outOfWindow));
    mockFetchApiMeetByName.mockRejectedValue(new Error("Network request failed"));
    mockFetchMeetsFresh.mockRejectedValue(new Error("Network request failed"));

    const tree = await mount();

    expect(captured!.selectedMeet).toBe("Archived Meet");
    expect(captured!.meetDetails?.venue.address.street).toBe("1 Main");
    expect(captured!.isLoading).toBe(false);
    act(() => tree.unmount());
  });

  it.each([
    ["not JSON", "{truncated"],
    ["another meet's details", JSON.stringify(makeMeet("Different Meet"))],
    ["an older shape without venue.address", JSON.stringify({ ...makeMeet("Archived Meet"), venue: { name: "x" } })],
    ["an array", "[]"],
  ])("does not hand persisted details that are %s to the Info tab", async (_label, raw) => {
    await AsyncStorage.setItem(SELECTED_MEET_KEY, "Archived Meet");
    await AsyncStorage.setItem(SELECTED_MEET_DETAILS_KEY, raw);
    mockFetchApiMeetByName.mockRejectedValue(new Error("Network request failed"));
    mockFetchMeetsFresh.mockRejectedValue(new Error("Network request failed"));

    const tree = await mount();

    // Falls back to a meet it can render...
    expect(captured!.selectedMeet).toBe("Window Meet");
    expect(captured!.meetDetails?.name).toBe("Window Meet");
    // ...but a failed lookup is not proof the stored choice is gone.
    await expect(AsyncStorage.getItem(SELECTED_MEET_KEY)).resolves.toBe("Archived Meet");
    act(() => tree.unmount());
  });

  it("forgets a stored meet only when an online lookup says it no longer exists", async () => {
    await AsyncStorage.setItem(SELECTED_MEET_KEY, "Deleted Meet");
    await AsyncStorage.setItem(SELECTED_MEET_DETAILS_KEY, JSON.stringify(makeMeet("Deleted Meet")));
    mockFetchApiMeetByName.mockResolvedValue(null);
    mockFetchMeetsFresh.mockResolvedValue([makeMeet("Window Meet")]);

    const tree = await mount();

    expect(captured!.selectedMeet).toBe("Window Meet");
    await expect(AsyncStorage.getItem(SELECTED_MEET_DETAILS_KEY)).resolves.toBeNull();
    act(() => tree.unmount());
  });

  it("keeps the current meet and storage when selecting an unknown meet fails on the network", async () => {
    mockFetchMeetsFresh.mockResolvedValue([makeMeet("Window Meet")]);
    const tree = await mount();
    expect(captured!.selectedMeet).toBe("Window Meet");
    await AsyncStorage.setItem(SELECTED_MEET_KEY, "Window Meet");

    mockFetchApiMeetByName.mockRejectedValue(new Error("timed out"));
    let failure: unknown = null;
    await act(async () => {
      failure = await captured!.setSelectedMeet("Elsewhere Meet" as MeetName).catch((e: unknown) => e);
    });

    expect((failure as Error).message).toBe("timed out");
    expect(captured!.selectedMeet).toBe("Window Meet");
    await expect(AsyncStorage.getItem(SELECTED_MEET_KEY)).resolves.toBe("Window Meet");
    act(() => tree.unmount());
  });

  it("clears the selection when the meet definitively does not exist", async () => {
    mockFetchMeetsFresh.mockResolvedValue([makeMeet("Window Meet")]);
    const tree = await mount();
    await AsyncStorage.setItem(SELECTED_MEET_KEY, "Window Meet");

    mockFetchApiMeetByName.mockResolvedValue(null);
    let failure: unknown = null;
    await act(async () => {
      failure = await captured!.setSelectedMeet("Typo Meet" as MeetName).catch((e: unknown) => e);
    });

    expect((failure as Error).message).toContain("not found");
    await expect(AsyncStorage.getItem(SELECTED_MEET_KEY)).resolves.toBeNull();
    // The cleared selection is refilled from the meets list, never with the
    // name that failed to resolve.
    expect(captured!.selectedMeet).toBe("Window Meet");
    act(() => tree.unmount());
  });

  it("persists an out-of-window selection's details for the next offline start", async () => {
    mockFetchMeetsFresh.mockResolvedValue([makeMeet("Window Meet")]);
    const tree = await mount();

    mockFetchApiMeetByName.mockResolvedValue(makeMeet("Deep Link Meet"));
    await act(async () => {
      await captured!.setSelectedMeet("Deep Link Meet" as MeetName);
    });
    await flush();

    expect(captured!.selectedMeet).toBe("Deep Link Meet");
    await expect(AsyncStorage.getItem(SELECTED_MEET_KEY)).resolves.toBe("Deep Link Meet");
    const persisted = JSON.parse((await AsyncStorage.getItem(SELECTED_MEET_DETAILS_KEY)) ?? "null");
    expect(persisted?.name).toBe("Deep Link Meet");
    act(() => tree.unmount());
  });

  describe("when the selected meet is missing from a fresh /meets list", () => {
    // The stored meet is in the cached window (so it is painted first) but
    // the fresh list no longer has it: it may have moved out of the window.
    beforeEach(async () => {
      await AsyncStorage.setItem(SELECTED_MEET_KEY, "Old Meet");
      mockGetCachedMeets.mockResolvedValue([makeMeet("Old Meet"), makeMeet("Window Meet")]);
      mockFetchMeetsFresh.mockResolvedValue([makeMeet("Window Meet")]);
    });

    it("keeps the selection and its storage when the by-name lookup fails", async () => {
      mockFetchApiMeetByName.mockRejectedValue(new Error("Network request failed"));
      const tree = await mount();

      expect(mockFetchApiMeetByName).toHaveBeenCalledWith("Old Meet");
      expect(captured!.selectedMeet).toBe("Old Meet");
      expect(captured!.meetDetails?.name).toBe("Old Meet");
      await expect(AsyncStorage.getItem(SELECTED_MEET_KEY)).resolves.toBe("Old Meet");
      act(() => tree.unmount());
    });

    it("keeps the selection and persists its details when the lookup finds it", async () => {
      const resolved = { ...makeMeet("Old Meet"), status: "completed" } as Meet;
      mockFetchApiMeetByName.mockResolvedValue(resolved);
      const tree = await mount();

      expect(captured!.selectedMeet).toBe("Old Meet");
      expect(captured!.meetDetails).toEqual(resolved);
      await expect(AsyncStorage.getItem(SELECTED_MEET_KEY)).resolves.toBe("Old Meet");
      const persisted: unknown = JSON.parse(
        (await AsyncStorage.getItem(SELECTED_MEET_DETAILS_KEY)) ?? "null",
      );
      expect(persisted).toEqual(resolved);
      act(() => tree.unmount());
    });

    it("falls back to the first fresh meet and clears storage when the meet is gone", async () => {
      await AsyncStorage.setItem(SELECTED_MEET_DETAILS_KEY, JSON.stringify(makeMeet("Old Meet")));
      mockFetchApiMeetByName.mockResolvedValue(null);
      const tree = await mount();
      await flush();

      expect(captured!.selectedMeet).toBe("Window Meet");
      expect(captured!.meetDetails?.name).toBe("Window Meet");
      await expect(AsyncStorage.getItem(SELECTED_MEET_KEY)).resolves.toBeNull();
      await expect(AsyncStorage.getItem(SELECTED_MEET_DETAILS_KEY)).resolves.toBeNull();
      act(() => tree.unmount());
    });
  });

  it("restores the previous meet and rethrows when saving a new selection fails", async () => {
    mockFetchMeetsFresh.mockResolvedValue([makeMeet("Window Meet"), makeMeet("Other Meet")]);
    const tree = await mount();
    // The previous meet is one a list refresh would not pick again by
    // itself: out of the window, selected by name.
    mockFetchApiMeetByName.mockResolvedValueOnce(makeMeet("Deep Link Meet"));
    await act(async () => {
      await captured!.setSelectedMeet("Deep Link Meet" as MeetName);
    });
    await flush();
    expect(captured!.selectedMeet).toBe("Deep Link Meet");

    const diskFull = new Error("disk full");
    jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(diskFull);
    let failure: unknown = null;
    await act(async () => {
      failure = await captured!.setSelectedMeet("Other Meet" as MeetName).catch((e: unknown) => e);
    });
    await flush();

    expect(failure).toBe(diskFull);
    expect(captured!.selectedMeet).toBe("Deep Link Meet");
    expect(captured!.meetDetails?.name).toBe("Deep Link Meet");
    // The failed selection never warmed.
    expect(mockWarmMeetData).not.toHaveBeenCalledWith("Other Meet");
    act(() => tree.unmount());
  });

  // The profile screen's Clear Cache reports success only when both resolve.
  it("refreshAvailableMeets rejects when the fresh list cannot be fetched, keeping the list", async () => {
    mockFetchMeetsFresh.mockResolvedValue([makeMeet("Window Meet")]);
    const tree = await mount();

    const down = new Error("Network request failed");
    mockFetchMeetsFresh.mockRejectedValueOnce(down);
    let failure: unknown = null;
    await act(async () => {
      failure = await captured!.refreshAvailableMeets().catch((e: unknown) => e);
    });

    expect(failure).toBe(down);
    expect(captured!.availableMeets.map((m) => m.name)).toEqual(["Window Meet"]);
    act(() => tree.unmount());
  });

  it("forceSync rejects when the selected meet cannot be re-downloaded", async () => {
    mockFetchMeetsFresh.mockResolvedValue([makeMeet("Window Meet")]);
    const tree = await mount();
    expect(captured!.selectedMeet).toBe("Window Meet");

    const down = new Error("Network request failed");
    mockPrefetchMeetData.mockRejectedValueOnce(down);
    let failure: unknown = null;
    await act(async () => {
      failure = await captured!.forceSync().catch((e: unknown) => e);
    });

    expect(mockPrefetchMeetData).toHaveBeenCalledWith("Window Meet");
    expect(failure).toBe(down);
    act(() => tree.unmount());
  });
});
