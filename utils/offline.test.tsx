import React from "react";
import { Alert } from "react-native";
import { act, create } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { OFFLINE_CACHE_KEYS } from "@/lib/database/offline-cache";
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

// Network fetchers: each would hit the API and then rewrite its cache.
const mockFetchStandards = jest.fn(async () => {});
const mockFetchQualifyingTotals = jest.fn(async () => {});
jest.mock("@/lib/database/fetch-standards", () => ({
  fetchStandards: () => mockFetchStandards(),
}));
jest.mock("@/lib/database/fetch-qualifying-totals", () => ({
  fetchQualifyingTotals: () => mockFetchQualifyingTotals(),
}));
jest.mock("@/lib/database/fetch-adaptive-records", () => ({ fetchAdaptiveRecords: jest.fn() }));
jest.mock("@/lib/database/fetch-records", () => ({
  fetchFederations: jest.fn(async () => []),
  fetchRecords: jest.fn(),
}));
jest.mock("@/lib/database/fetch-wso-records", () => ({
  fetchWSOList: jest.fn(async () => []),
  fetchWSORecords: jest.fn(),
}));
jest.mock("@/lib/database/fetchIntlRankings", () => ({ fetchIntlRankings: jest.fn() }));

const mockPrefetchMeetData = jest.fn(async (_meet: string) => {});
jest.mock("@/lib/database/meet-manager", () => ({
  prefetchMeetData: (meet: string) => mockPrefetchMeetData(meet),
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
  captured = useOfflineData();
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
  const button = buttons.find((b) => b.text === text);
  await act(async () => {
    await button?.onPress?.();
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

beforeEach(async () => {
  jest.clearAllMocks();
  captured = null;
  mockIsNetworkAvailable.mockResolvedValue(true);
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

  it("re-downloads only what was downloaded, and keeps athlete history", async () => {
    const tree = await mount();

    act(() => captured!.confirmRefreshAll());
    await tap("Refresh All");

    expect(mockFetchStandards).toHaveBeenCalledTimes(1);
    expect(mockFetchQualifyingTotals).not.toHaveBeenCalled();
    expect(mockPrefetchMeetData.mock.calls).toEqual([["Meet A"]]);
    expect(mockMarkMeetExplicitlyDownloaded).toHaveBeenCalledWith("Meet A", true, {
      endDate: "2099-06-22",
    });
    expect(mockClearAllAthleteHistory).not.toHaveBeenCalled();
    expect(alertSpy.mock.calls.at(-1)?.[0]).toBe("Refresh Complete");
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
