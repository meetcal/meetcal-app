import React from "react";
import { Alert } from "react-native";
import { act, create } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BROWSE_CACHE_KEYS, OFFLINE_CACHE_KEYS } from "@/lib/database/offline-cache";
import { resetOfflineActivityForTests } from "@/lib/database/offline-activity";
import { useOfflineData } from "@/utils/offline";

const mockIsNetworkAvailable = jest.fn<Promise<boolean>, []>(async () => true);
jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: () => mockIsNetworkAvailable(),
}));

jest.mock("@/contexts/SubscriptionContext", () => ({
  useSubscription: () => ({ isSubscribed: true, isLoading: false }),
}));

const MEETS = [
  { name: "Meet A", dates: { start: "2099-06-20", end: "2099-06-22" } },
  { name: "Meet B", dates: { start: "2099-07-01", end: "2099-07-02" } },
];
jest.mock("@/contexts/SelectedMeetContext", () => ({
  useSelectedMeet: () => ({ availableMeets: MEETS, isLoading: false }),
}));

// Network downloads: each would hit the API and then rewrite its cache.
const mockFetchStandards = jest.fn(async () => {});
const mockFetchQualifyingTotals = jest.fn(async () => {});
jest.mock("@/lib/database/fetch-standards", () => ({
  downloadStandardsForOffline: () => mockFetchStandards(),
}));
jest.mock("@/lib/database/fetch-qualifying-totals", () => ({
  downloadQualifyingTotalsForOffline: () => mockFetchQualifyingTotals(),
}));
jest.mock("@/lib/database/fetch-adaptive-records", () => ({
  downloadAdaptiveRecordsForOffline: jest.fn(),
}));
jest.mock("@/lib/database/fetch-records", () => ({
  downloadRecordsForOffline: jest.fn(),
}));
jest.mock("@/lib/database/fetch-wso-records", () => ({
  downloadWSORecordsForOffline: jest.fn(),
}));
jest.mock("@/lib/database/fetchIntlRankings", () => ({
  downloadIntlRankingsForOffline: jest.fn(),
}));

const mockPrefetchMeetData = jest.fn(async (_meet: string, _options?: unknown) => {});
jest.mock("@/lib/database/meet-manager", () => ({
  prefetchMeetData: (meet: string, options?: unknown) => mockPrefetchMeetData(meet, options),
}));

const mockClearMeetData = jest.fn(async (_meet: string, _options?: unknown) => {});
const mockClearAllAthleteHistory = jest.fn(async () => {});
const mockMarkMeetExplicitlyDownloaded = jest.fn(async (..._args: unknown[]) => {});
const mockReadStorageKeysForMeetClear = jest.fn(async (_count: number) => ["k1", "k2"]);
jest.mock("@/lib/database/offline-store", () => ({
  clearAllAthleteHistory: () => mockClearAllAthleteHistory(),
  clearMeetData: (meet: string, options?: unknown) => mockClearMeetData(meet, options),
  getExplicitlyDownloadedMeetIds: async () => new Set(["Meet A"]),
  getLastSyncTime: async () => 1,
  markMeetExplicitlyDownloaded: (...args: unknown[]) => mockMarkMeetExplicitlyDownloaded(...args),
  readStorageKeysForMeetClear: (count: number) => mockReadStorageKeysForMeetClear(count),
}));

type Hook = ReturnType<typeof useOfflineData>;
let captured: Hook | null = null;

function Harness() {
  const value = useOfflineData();
  // Assigned after commit, not during render, so the test double stays
  // within the rules of hooks; every read below happens after `act`.
  React.useEffect(() => {
    captured = value;
  });
  return null;
}

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
};

type AlertButton = { text: string; onPress?: () => unknown };
let alertSpy: jest.SpyInstance;

/** Taps the named button of the most recent alert and waits for its work. */
async function tap(text: string) {
  const buttons = alertSpy.mock.calls.at(-1)?.[2] as AlertButton[];
  const button = buttons?.find((b) => b.text === text);
  // A missing button would make every "was not called" assertion after it
  // pass without the tap ever happening.
  if (!button?.onPress) throw new Error(`no "${text}" button on the last alert`);
  await act(async () => {
    await button.onPress?.();
  });
  await flush();
}

async function mount() {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<Harness />);
  });
  await flush();
  return tree;
}

const cacheEntry = JSON.stringify({ data: { any: "rows" }, lastSynced: 1 });
const freshEntry = JSON.stringify({ data: { any: "fresh rows" }, lastSynced: 2 });

beforeEach(async () => {
  resetOfflineActivityForTests();
  jest.clearAllMocks();
  captured = null;
  mockIsNetworkAvailable.mockReset();
  mockIsNetworkAvailable.mockResolvedValue(true);
  // A successful download writes over the stored copy.
  mockFetchStandards.mockImplementation(async () => {
    await AsyncStorage.setItem(OFFLINE_CACHE_KEYS.standards, freshEntry);
  });
  mockPrefetchMeetData.mockImplementation(async () => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  await AsyncStorage.clear();
  // Standards are downloaded; qualifying totals are not.
  await AsyncStorage.setItem(OFFLINE_CACHE_KEYS.standards, cacheEntry);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("useOfflineData refresh all", () => {
  it("keeps every download when Refresh All is tapped offline", async () => {
    mockIsNetworkAvailable.mockResolvedValue(false);
    const tree = await mount();
    expect(captured!.downloadStatuses.standards?.isDownloaded).toBe(true);

    act(() => captured!.confirmRefreshAll());
    await tap("Refresh All");

    // Refresh used to delete first and re-download second; offline, the
    // second half cannot happen and the user was left with nothing.
    await expect(AsyncStorage.getItem(OFFLINE_CACHE_KEYS.standards)).resolves.toBe(cacheEntry);
    expect(mockClearMeetData).not.toHaveBeenCalled();
    expect(mockFetchStandards).not.toHaveBeenCalled();
    expect(mockPrefetchMeetData).not.toHaveBeenCalled();
    expect(alertSpy.mock.calls.at(-1)?.[0]).toBe("You're Offline");
    expect(captured!.isRefreshingAll).toBe(false);
    act(() => tree.unmount());
  });

  it("re-downloads only what was downloaded, over the old copy, and keeps athlete history", async () => {
    const tree = await mount();

    act(() => captured!.confirmRefreshAll());
    await tap("Refresh All");

    expect(mockFetchStandards).toHaveBeenCalledTimes(1);
    expect(mockFetchQualifyingTotals).not.toHaveBeenCalled();
    // A user refresh re-fetches history even when the package answers 304.
    expect(mockPrefetchMeetData.mock.calls).toEqual([
      ["Meet A", { forceHistoryRefresh: true }],
    ]);
    // Written over in place: nothing is cleared first.
    expect(mockClearMeetData).not.toHaveBeenCalled();
    await expect(AsyncStorage.getItem(OFFLINE_CACHE_KEYS.standards)).resolves.toBe(freshEntry);
    expect(mockMarkMeetExplicitlyDownloaded).toHaveBeenCalledWith("Meet A", true, {
      endDate: "2099-06-22",
    });
    expect(mockClearAllAthleteHistory).not.toHaveBeenCalled();
    expect(alertSpy.mock.calls.at(-1)?.[0]).toBe("Refresh Complete");
    act(() => tree.unmount());
  });
});

describe("useOfflineData refresh all, partial failure", () => {
  it("keeps the old copy of an item whose API call fails and replaces the rest", async () => {
    mockFetchStandards.mockRejectedValueOnce(new Error("MeetCal API error 500"));
    const tree = await mount();

    act(() => captured!.confirmRefreshAll());
    await tap("Refresh All");

    // Standards failed: the old download is still on disk.
    await expect(AsyncStorage.getItem(OFFLINE_CACHE_KEYS.standards)).resolves.toBe(cacheEntry);
    // The meet after it still refreshed, and was never cleared or unmarked.
    expect(mockPrefetchMeetData).toHaveBeenCalledWith("Meet A", { forceHistoryRefresh: true });
    expect(mockClearMeetData).not.toHaveBeenCalled();
    expect(mockMarkMeetExplicitlyDownloaded).toHaveBeenCalledWith("Meet A", true, {
      endDate: "2099-06-22",
    });
    expect(mockMarkMeetExplicitlyDownloaded).not.toHaveBeenCalledWith("Meet A", false);

    const [title, message] = alertSpy.mock.calls.at(-1) ?? [];
    expect(title).toBe("Refresh Incomplete");
    expect(message).toContain("A/B Standards");
    expect(message).not.toContain("Meet A");
    expect(captured!.isRefreshingAll).toBe(false);
    act(() => tree.unmount());
  });

  it("keeps a meet whose re-download fails downloaded, with its data", async () => {
    mockPrefetchMeetData.mockRejectedValueOnce(
      new Error("Offline prefetch incomplete (Meet A): meet_package"),
    );
    const tree = await mount();

    act(() => captured!.confirmRefreshAll());
    await tap("Refresh All");

    // Old refresh: clearMeetData wiped the roster/schedule and the
    // "downloaded" mark before the failed re-download.
    expect(mockClearMeetData).not.toHaveBeenCalled();
    expect(mockMarkMeetExplicitlyDownloaded).not.toHaveBeenCalled();
    // The standards before it were replaced.
    await expect(AsyncStorage.getItem(OFFLINE_CACHE_KEYS.standards)).resolves.toBe(freshEntry);

    const [title, message] = alertSpy.mock.calls.at(-1) ?? [];
    expect(title).toBe("Refresh Incomplete");
    expect(message).toContain("Meet A");
    expect(message).toContain("still on this device");
    act(() => tree.unmount());
  });

  it("stops when the connection drops mid-refresh and reports every item not refreshed", async () => {
    const tree = await mount();
    // Up for the pre-check, gone by the time standards fails.
    mockIsNetworkAvailable.mockResolvedValueOnce(true).mockResolvedValue(false);
    mockFetchStandards.mockRejectedValueOnce(new Error("Network request failed"));

    act(() => captured!.confirmRefreshAll());
    await tap("Refresh All");

    await expect(AsyncStorage.getItem(OFFLINE_CACHE_KEYS.standards)).resolves.toBe(cacheEntry);
    expect(mockPrefetchMeetData).not.toHaveBeenCalled();
    expect(mockClearMeetData).not.toHaveBeenCalled();

    const [title, message] = alertSpy.mock.calls.at(-1) ?? [];
    expect(title).toBe("Refresh Failed");
    expect(message).toContain("connection was lost");
    expect(message).toContain("A/B Standards, Meet A");
    act(() => tree.unmount());
  });
});

describe("useOfflineData delete all", () => {
  it("removes every cache, each meet with one shared key listing, and athlete history", async () => {
    await AsyncStorage.setItem(OFFLINE_CACHE_KEYS.qualifyingTotals, cacheEntry);
    const tree = await mount();

    act(() => captured!.confirmDeleteAll());
    await tap("Delete All");

    await expect(AsyncStorage.getItem(OFFLINE_CACHE_KEYS.standards)).resolves.toBeNull();
    await expect(AsyncStorage.getItem(OFFLINE_CACHE_KEYS.qualifyingTotals)).resolves.toBeNull();
    expect(mockReadStorageKeysForMeetClear).toHaveBeenCalledTimes(1);
    expect(mockClearMeetData.mock.calls).toEqual([
      ["Meet A", { storageKeys: ["k1", "k2"] }],
      ["Meet B", { storageKeys: ["k1", "k2"] }],
    ]);
    expect(mockClearAllAthleteHistory).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls.at(-1)?.[0]).toBe("Deleted");
    act(() => tree.unmount());
  });

  it("also removes the caches filled by browsing rankings, clubs and records", async () => {
    for (const key of BROWSE_CACHE_KEYS) await AsyncStorage.setItem(key, cacheEntry);
    const tree = await mount();

    act(() => captured!.confirmDeleteAll());
    await tap("Delete All");

    for (const key of [
      OFFLINE_CACHE_KEYS.nationalRankings,
      OFFLINE_CACHE_KEYS.clubAthletes,
      OFFLINE_CACHE_KEYS.clubMeetStats,
      OFFLINE_CACHE_KEYS.wsoRecordsFiltered,
    ]) {
      await expect(AsyncStorage.getItem(key)).resolves.toBeNull();
    }
    act(() => tree.unmount());
  });

  it("re-reads the rows when it finishes, so they show not downloaded", async () => {
    await AsyncStorage.setItem(OFFLINE_CACHE_KEYS.qualifyingTotals, cacheEntry);
    const tree = await mount();
    expect(captured!.downloadStatuses.standards?.isDownloaded).toBe(true);
    expect(captured!.downloadStatuses.qualifyingTotals?.isDownloaded).toBe(true);

    act(() => captured!.confirmDeleteAll());
    await tap("Delete All");

    // Only the end of the action (`settled`) triggers the re-read; nothing
    // else about the rows changed.
    expect(captured!.isDeletingAll).toBe(false);
    expect(captured!.downloadStatuses.standards).toEqual({ isDownloaded: false, lastSynced: null });
    expect(captured!.downloadStatuses.qualifyingTotals).toEqual({
      isDownloaded: false,
      lastSynced: null,
    });
    act(() => tree.unmount());
  });
});

describe("useOfflineData single download", () => {
  it("marks a meet downloaded, with its end date, only after the download succeeds", async () => {
    const tree = await mount();
    const action = jest.fn(async () => {});

    await act(async () => {
      await captured!.handleDownload("meet:Meet B", action);
    });
    await flush();

    expect(action).toHaveBeenCalledTimes(1);
    expect(mockMarkMeetExplicitlyDownloaded).toHaveBeenCalledWith("Meet B", true, {
      endDate: "2099-07-02",
    });
    expect(captured!.downloadingItems.has("meet:Meet B")).toBe(false);
    act(() => tree.unmount());
  });

  it("surfaces a failed download and never marks the meet downloaded", async () => {
    const tree = await mount();
    const action = jest.fn(async () => {
      throw new Error("MeetCal API error 500");
    });

    await act(async () => {
      await captured!.handleDownload("meet:Meet B", action);
    });
    await flush();

    // A meet marked downloaded is kept past its end date and shown as
    // available offline; a failed download must not claim that.
    expect(mockMarkMeetExplicitlyDownloaded).not.toHaveBeenCalled();
    expect(alertSpy.mock.calls.at(-1)?.[0]).toBe("Download Failed");
    expect(captured!.downloadingItems.size).toBe(0);
    act(() => tree.unmount());
  });

  it("does not mark a meet for a competition item or a meet the app no longer lists", async () => {
    const tree = await mount();

    await act(async () => {
      await captured!.handleDownload("standards", async () => {});
      await captured!.handleDownload("meet:Removed Meet", async () => {});
    });
    await flush();

    expect(mockMarkMeetExplicitlyDownloaded).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});

describe("useOfflineData single actions vs bulk actions", () => {
  /** A download the test finishes by hand. */
  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it("does not remove an item whose Remove is confirmed while Refresh All runs", async () => {
    const gate = deferred();
    mockPrefetchMeetData.mockImplementation(() => gate.promise);
    const tree = await mount();

    // The row's confirmation opens before the refresh starts.
    const removeStandards = jest.fn(async () => {});
    await act(async () => {
      await captured!.handleDelete("A/B Standards", "standards", removeStandards);
    });
    expect(alertSpy.mock.calls.at(-1)?.[0]).toBe("Remove Download");
    const removeButtons = alertSpy.mock.calls.at(-1)?.[2] as AlertButton[];
    // Otherwise "not removed" below would hold without the tap happening.
    expect(removeButtons.find((b) => b.text === "Remove")?.onPress).toBeInstanceOf(Function);

    act(() => captured!.confirmRefreshAll());
    const refreshButtons = alertSpy.mock.calls.at(-1)?.[2] as AlertButton[];
    let refreshing!: Promise<unknown>;
    await act(async () => {
      refreshing = Promise.resolve(refreshButtons.find((b) => b.text === "Refresh All")?.onPress?.());
      await new Promise((r) => setTimeout(r, 0));
    });

    // Confirmed mid-refresh: the refresh listed standards before this tap
    // and would write them back after the removal.
    await act(async () => {
      await removeButtons.find((b) => b.text === "Remove")?.onPress?.();
    });
    expect(removeStandards).not.toHaveBeenCalled();

    await act(async () => {
      gate.resolve();
      await refreshing;
    });
    await flush();
    expect(alertSpy.mock.calls.at(-1)?.[0]).toBe("Refresh Complete");
    act(() => tree.unmount());
  });

  it("ignores a row download while Refresh All runs", async () => {
    const gate = deferred();
    mockPrefetchMeetData.mockImplementation(() => gate.promise);
    const tree = await mount();

    act(() => captured!.confirmRefreshAll());
    await act(async () => {
      void (alertSpy.mock.calls.at(-1)?.[2] as AlertButton[])
        .find((b) => b.text === "Refresh All")
        ?.onPress?.();
      await new Promise((r) => setTimeout(r, 0));
    });

    const download = jest.fn(async () => {});
    await act(async () => {
      await captured!.handleDownload("meet:Meet B", download);
    });
    expect(download).not.toHaveBeenCalled();
    expect(mockMarkMeetExplicitlyDownloaded).not.toHaveBeenCalledWith("Meet B", true, expect.anything());

    await act(async () => {
      gate.resolve();
    });
    await flush();
    act(() => tree.unmount());
  });

  it("runs one refresh when two queued Refresh All alerts are both confirmed", async () => {
    const gate = deferred();
    mockPrefetchMeetData.mockImplementation(() => gate.promise);
    const tree = await mount();

    // Both alerts open from the same render, before either press.
    act(() => captured!.confirmRefreshAll());
    const first = alertSpy.mock.calls.at(-1)?.[2] as AlertButton[];
    act(() => captured!.confirmRefreshAll());
    const second = alertSpy.mock.calls.at(-1)?.[2] as AlertButton[];

    await act(async () => {
      void first.find((b) => b.text === "Refresh All")?.onPress?.();
      void second.find((b) => b.text === "Refresh All")?.onPress?.();
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      gate.resolve();
    });
    await flush();

    expect(mockFetchStandards).toHaveBeenCalledTimes(1);
    expect(mockPrefetchMeetData).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("refuses Refresh All and Delete All while a row download runs, then allows them", async () => {
    const gate = deferred();
    const tree = await mount();

    let downloading!: Promise<void>;
    await act(async () => {
      downloading = captured!.handleDownload("meet:Meet B", () => gate.promise);
    });

    act(() => captured!.confirmRefreshAll());
    await tap("Refresh All");
    expect(alertSpy.mock.calls.at(-1)?.[0]).toBe("Download in Progress");
    expect(mockFetchStandards).not.toHaveBeenCalled();

    act(() => captured!.confirmDeleteAll());
    await tap("Delete All");
    expect(alertSpy.mock.calls.at(-1)?.[0]).toBe("Download in Progress");
    expect(mockClearMeetData).not.toHaveBeenCalled();
    await expect(AsyncStorage.getItem(OFFLINE_CACHE_KEYS.standards)).resolves.toBe(cacheEntry);

    await act(async () => {
      gate.resolve();
      await downloading;
    });
    await flush();

    act(() => captured!.confirmRefreshAll());
    await tap("Refresh All");
    expect(mockFetchStandards).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls.at(-1)?.[0]).toBe("Refresh Complete");
    act(() => tree.unmount());
  });

  it("ignores a second tap on a row whose download is still running", async () => {
    const gate = deferred();
    const tree = await mount();
    const download = jest.fn(() => gate.promise);

    let taps!: Promise<unknown>;
    await act(async () => {
      taps = Promise.all([
        captured!.handleDownload("standards", download),
        captured!.handleDownload("standards", download),
      ]);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(download).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate.resolve();
      await taps;
    });
    act(() => tree.unmount());
  });
});

describe("useOfflineData across a remount of the screen", () => {
  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it("keeps Refresh All's claim after the user leaves and reopens the screen", async () => {
    const gate = deferred();
    mockPrefetchMeetData.mockImplementation(() => gate.promise);
    const first = await mount();

    act(() => captured!.confirmRefreshAll());
    let refreshing!: Promise<unknown>;
    await act(async () => {
      refreshing = Promise.resolve(
        (alertSpy.mock.calls.at(-1)?.[2] as AlertButton[])
          .find((b) => b.text === "Refresh All")
          ?.onPress?.(),
      );
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(mockPrefetchMeetData).toHaveBeenCalledTimes(1);

    // Swipe back mid-refresh, then open the screen again.
    act(() => first.unmount());
    const second = await mount();
    expect(captured!.isRefreshingAll).toBe(true);

    // Mounted flags used to say "idle": Delete All cleared storage and the
    // orphaned refresh wrote Meet A back; a second Refresh All re-ran it.
    act(() => captured!.confirmDeleteAll());
    await act(async () => {
      await (alertSpy.mock.calls.at(-1)?.[2] as AlertButton[])
        .find((b) => b.text === "Delete All")
        ?.onPress?.();
    });
    expect(mockClearMeetData).not.toHaveBeenCalled();
    expect(mockClearAllAthleteHistory).not.toHaveBeenCalled();

    await act(async () => {
      await captured!.handleDownload("meet:Meet B", async () => {});
    });
    expect(mockMarkMeetExplicitlyDownloaded).not.toHaveBeenCalledWith(
      "Meet B",
      true,
      expect.anything(),
    );

    await act(async () => {
      gate.resolve();
      await refreshing;
    });
    await flush();

    // The reopened screen sees the refresh end and is usable again.
    expect(captured!.isRefreshingAll).toBe(false);
    expect(captured!.downloadingItems.size).toBe(0);
    expect(mockPrefetchMeetData).toHaveBeenCalledTimes(1);
    act(() => captured!.confirmDeleteAll());
    await tap("Delete All");
    expect(mockClearAllAthleteHistory).toHaveBeenCalledTimes(1);
    act(() => second.unmount());
  });

  it("shows a row download started by an earlier mount as still downloading", async () => {
    const gate = deferred();
    const first = await mount();
    let downloading!: Promise<void>;
    await act(async () => {
      downloading = captured!.handleDownload("standards", () => gate.promise);
    });
    act(() => first.unmount());

    const second = await mount();
    expect(captured!.downloadingItems.has("standards")).toBe(true);
    const again = jest.fn(async () => {});
    await act(async () => {
      await captured!.handleDownload("standards", again);
    });
    expect(again).not.toHaveBeenCalled();

    await act(async () => {
      gate.resolve();
      await downloading;
    });
    await flush();
    expect(captured!.downloadingItems.has("standards")).toBe(false);
    act(() => second.unmount());
  });
});

describe("useOfflineData failure paths release their claim", () => {
  // The busy flags outlive the screen (offline-activity), so a claim a
  // failure path forgot to release would lock every row and both header
  // actions until the app process restarts.

  it("Delete All that fails part-way reports it, and the screen is usable again", async () => {
    mockClearAllAthleteHistory.mockRejectedValueOnce(new Error("disk full"));
    const tree = await mount();

    act(() => captured!.confirmDeleteAll());
    await tap("Delete All");

    expect(alertSpy.mock.calls.at(-1)?.[0]).toBe("Delete Failed");
    expect(captured!.isDeletingAll).toBe(false);

    act(() => captured!.confirmDeleteAll());
    await tap("Delete All");
    expect(mockClearAllAthleteHistory).toHaveBeenCalledTimes(2);
    expect(alertSpy.mock.calls.at(-1)?.[0]).toBe("Deleted");
    act(() => tree.unmount());
  });

  it("Refresh All that throws keeps the downloads, says so, and can run again", async () => {
    mockIsNetworkAvailable.mockRejectedValueOnce(new Error("NetInfo unavailable"));
    const tree = await mount();

    act(() => captured!.confirmRefreshAll());
    await tap("Refresh All");

    const [title, message] = alertSpy.mock.calls.at(-1) ?? [];
    expect(title).toBe("Refresh Failed");
    expect(message).toContain("kept");
    await expect(AsyncStorage.getItem(OFFLINE_CACHE_KEYS.standards)).resolves.toBe(cacheEntry);
    expect(captured!.isRefreshingAll).toBe(false);

    act(() => captured!.confirmRefreshAll());
    await tap("Refresh All");
    expect(mockFetchStandards).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls.at(-1)?.[0]).toBe("Refresh Complete");
    act(() => tree.unmount());
  });

  it("a Remove that fails reports it and frees the row", async () => {
    const tree = await mount();
    const remove = jest.fn(async () => {
      throw new Error("storage error");
    });

    await act(async () => {
      await captured!.handleDelete("A/B Standards", "standards", remove);
    });
    await tap("Remove");

    expect(remove).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls.at(-1)?.[0]).toBe("Remove Failed");
    expect(captured!.downloadingItems.has("standards")).toBe(false);
    const again = jest.fn(async () => {});
    await act(async () => {
      await captured!.handleDownload("standards", again);
    });
    expect(again).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });
});
