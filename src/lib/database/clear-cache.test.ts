/**
 * Profile "Clear Cache" policy, against the real offline store (AsyncStorage
 * mock) and the real Offline Data activity lock. Only the network probe and
 * the two refresh callbacks (context functions) are stubbed.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isNetworkAvailable } from "@/lib/networkUtils";
import {
  claimOfflineBulk,
  claimOfflineItem,
  getOfflineActivity,
  resetOfflineActivityForTests,
} from "@/lib/database/offline-activity";
import { clearCachedMeetData, clearCacheToast } from "@/lib/database/clear-cache";
import { MEETS_LIST_CACHE_KEY } from "@/lib/database/meets-list-cache";
import { BROWSE_CACHE_KEYS } from "@/lib/database/offline-cache";
import * as offlineStore from "@/lib/database/offline-store";
import {
  getExplicitMeetDownloadEntries,
  markMeetExplicitlyDownloaded,
} from "@/lib/database/offline-store";

// The meet download itself (network + ingest) is meet-manager's; here only
// what Clear Cache asks of it matters.
const mockPrefetchMeetData = jest.fn(async (_meet: string, _options?: unknown) => {});
let mockTrustedNow: Date | null = null;
// The server clock sample the clear waits for; none arrives by default.
const mockAwaitServerClock = jest.fn(async (): Promise<unknown> => null);
jest.mock("@/lib/api/meetcal-api", () => ({
  ...jest.requireActual("@/lib/api/meetcal-api"),
  getTrustedNow: () => mockTrustedNow,
  awaitServerClock: () => mockAwaitServerClock(),
}));
jest.mock("@/lib/database/meet-manager", () => ({
  ...jest.requireActual("@/lib/database/meet-manager"),
  prefetchMeetData: (meet: string, options?: unknown) => mockPrefetchMeetData(meet, options),
}));

jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(async () => true),
  subscribeToNetworkChanges: () => () => {},
}));

const mockIsNetworkAvailable = isNetworkAvailable as jest.MockedFunction<
  typeof isNetworkAvailable
>;

const HISTORY_KEY = "meetcal_athlete_history_Jane Doe";

async function seedDownloads(): Promise<void> {
  await AsyncStorage.setItem(HISTORY_KEY, "blob");
}

function deps(overrides: Partial<Parameters<typeof clearCachedMeetData>[0]> = {}) {
  return {
    refreshAvailableMeets: jest.fn(async () => {}),
    refreshSelectedMeet: jest.fn(async () => {}),
    ...overrides,
  };
}

describe("clearCachedMeetData", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrefetchMeetData.mockReset();
    mockTrustedNow = null;
    mockAwaitServerClock.mockImplementation(async () => null);
    mockPrefetchMeetData.mockImplementation(async () => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    resetOfflineActivityForTests();
    await AsyncStorage.clear();
    mockIsNetworkAvailable.mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("refuses offline without deleting any download", async () => {
    mockIsNetworkAvailable.mockResolvedValue(false);
    await seedDownloads();
    const d = deps();

    const outcome = await clearCachedMeetData(d);

    expect(outcome).toEqual({ status: "offline" });
    await expect(AsyncStorage.getItem(HISTORY_KEY)).resolves.toBe("blob");
    expect(d.refreshAvailableMeets).not.toHaveBeenCalled();
    expect(clearCacheToast(outcome).type).toBe("error");
  });

  it.each([
    ["a Refresh All", () => claimOfflineBulk("refresh")],
    ["a single meet download", () => claimOfflineItem("meet:Nationals")],
  ])("refuses while %s holds the offline lock", async (_label, claim) => {
    await seedDownloads();
    claim();
    const before = getOfflineActivity();

    const outcome = await clearCachedMeetData(deps());

    expect(outcome).toEqual({ status: "busy" });
    await expect(AsyncStorage.getItem(HISTORY_KEY)).resolves.toBe("blob");
    // The other action's claim is untouched.
    expect(getOfflineActivity()).toBe(before);
  });

  it("holds the delete lock for the whole run so no Refresh All can start mid-clear", async () => {
    await seedDownloads();
    const seen: (string | null)[] = [];
    const d = deps({
      refreshAvailableMeets: jest.fn(async () => {
        seen.push(getOfflineActivity().bulk);
        seen.push(claimOfflineBulk("refresh"));
      }),
    });

    const outcome = await clearCachedMeetData(d);

    expect(outcome).toEqual({ status: "cleared" });
    expect(seen).toEqual(["delete", "bulk-running"]);
    expect(getOfflineActivity().bulk).toBeNull();
  });

  it("clears everything, refreshes both, and reports success", async () => {
    await seedDownloads();
    await AsyncStorage.setItem(MEETS_LIST_CACHE_KEY, "[]");
    for (const key of BROWSE_CACHE_KEYS) await AsyncStorage.setItem(key, "{}");
    const order: string[] = [];
    const d = deps({
      refreshAvailableMeets: jest.fn(async () => {
        order.push("meets");
      }),
      refreshSelectedMeet: jest.fn(async () => {
        order.push("selected");
      }),
    });

    const outcome = await clearCachedMeetData(d);

    expect(outcome).toEqual({ status: "cleared" });
    await expect(AsyncStorage.getItem(HISTORY_KEY)).resolves.toBeNull();
    await expect(AsyncStorage.getItem(MEETS_LIST_CACHE_KEY)).resolves.toBeNull();
    // Rankings, club and WSO browse caches go too; Clear Cache used to leave them.
    for (const key of BROWSE_CACHE_KEYS) {
      await expect(AsyncStorage.getItem(key)).resolves.toBeNull();
    }
    expect(order).toEqual(["meets", "selected"]);
    expect(clearCacheToast(outcome).type).toBe("success");
  });

  // Clear Cache wiped every offline download and re-synced only the selected
  // meet, which came back unmarked: no expiry date, no background refresh,
  // open to LRU eviction. A second meet downloaded for a trip was just gone.
  it("re-downloads every downloaded meet and keeps it marked downloaded, before the selected meet", async () => {
    await markMeetExplicitlyDownloaded("Meet A" as never, true, { endDate: "2099-06-20" });
    await markMeetExplicitlyDownloaded("Meet B" as never, true, { endDate: "2099-07-01" });
    const order: string[] = [];
    mockPrefetchMeetData.mockImplementation(async (meet) => {
      order.push(`download:${meet}`);
    });
    const d = deps({
      refreshSelectedMeet: jest.fn(async () => {
        order.push("selected");
      }),
    });

    const outcome = await clearCachedMeetData(d);

    expect(outcome).toEqual({ status: "cleared" });
    expect(order).toEqual(["download:Meet A", "download:Meet B", "selected"]);
    expect(mockPrefetchMeetData).toHaveBeenCalledWith("Meet A", { forceHistoryRefresh: true });
    await expect(getExplicitMeetDownloadEntries()).resolves.toEqual([
      { meet: "Meet A", endDate: "2099-06-20" },
      { meet: "Meet B", endDate: "2099-07-01" },
    ]);
  });

  it("does not bring back a download whose meet has ended on the server's clock", async () => {
    mockTrustedNow = new Date();
    await markMeetExplicitlyDownloaded("Ended" as never, true, { endDate: "2020-01-01" });
    await markMeetExplicitlyDownloaded("Upcoming" as never, true, { endDate: "2099-06-20" });

    await clearCachedMeetData(deps());

    expect(mockPrefetchMeetData.mock.calls.map(([meet]) => meet)).toEqual(["Upcoming"]);
  });

  // Early in a process no request has left a clock sample yet (they no
  // longer wait for one): the clear waits for it before judging what ended.
  it("waits for the server clock sample before deciding which downloads have ended", async () => {
    mockAwaitServerClock.mockImplementation(async () => {
      mockTrustedNow = new Date();
      return { skewMs: 0, sampledAt: Date.now() };
    });
    await markMeetExplicitlyDownloaded("Ended" as never, true, { endDate: "2020-01-01" });
    await markMeetExplicitlyDownloaded("Upcoming" as never, true, { endDate: "2099-06-20" });

    await clearCachedMeetData(deps());

    expect(mockAwaitServerClock).toHaveBeenCalled();
    expect(mockPrefetchMeetData.mock.calls.map(([meet]) => meet)).toEqual(["Upcoming"]);
  });

  it("says which downloads could not be re-downloaded instead of reporting success", async () => {
    await markMeetExplicitlyDownloaded("Meet A" as never, true, { endDate: "2099-06-20" });
    await markMeetExplicitlyDownloaded("Meet B" as never, true, { endDate: "2099-07-01" });
    mockPrefetchMeetData.mockImplementation(async (meet) => {
      if (meet === "Meet B") throw new Error("timeout");
    });

    const outcome = await clearCachedMeetData(deps());

    expect(outcome).toEqual({ status: "downloads-failed", failed: ["Meet B"] });
    expect(clearCacheToast(outcome)).toEqual({
      type: "error",
      message:
        "Cache cleared, but an offline download could not be re-downloaded. Download it again from Offline Data.",
    });
    await expect(getExplicitMeetDownloadEntries()).resolves.toEqual([
      { meet: "Meet A", endDate: "2099-06-20" },
    ]);
  });

  // A timed-out /meets request used to skip every re-download after the
  // downloads had been deleted, though each is fetched by name.
  it("still re-downloads the offline downloads when the meets list refresh fails", async () => {
    await markMeetExplicitlyDownloaded("Meet A" as never, true, { endDate: "2099-06-20" });
    const error = new Error("timeout");
    const refreshSelectedMeet = jest.fn(async () => {});

    const outcome = await clearCachedMeetData(
      deps({ refreshAvailableMeets: jest.fn(async () => Promise.reject(error)), refreshSelectedMeet }),
    );

    expect(mockPrefetchMeetData).toHaveBeenCalledWith("Meet A", { forceHistoryRefresh: true });
    expect(refreshSelectedMeet).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ status: "refresh-failed", error });
    await expect(getExplicitMeetDownloadEntries()).resolves.toEqual([
      { meet: "Meet A", endDate: "2099-06-20" },
    ]);
  });

  it("reports meets it could not clear instead of success", async () => {
    jest.spyOn(offlineStore, "clearAllMeetData").mockResolvedValueOnce({ failed: 2 });

    const outcome = await clearCachedMeetData(deps());

    expect(outcome).toEqual({ status: "clear-incomplete", failed: 2 });
    expect(clearCacheToast(outcome)).toEqual({
      type: "error",
      message: "Some cached meet data could not be cleared. Try Clear Cache again.",
    });
    expect(getOfflineActivity().bulk).toBeNull();
  });

  it.each(["refreshAvailableMeets", "refreshSelectedMeet"] as const)(
    "reports a failed %s instead of success and releases the lock",
    async (step) => {
      const error = new Error("network down");
      const outcome = await clearCachedMeetData(
        deps({ [step]: jest.fn(async () => Promise.reject(error)) }),
      );

      expect(outcome).toEqual({ status: "refresh-failed", error });
      expect(clearCacheToast(outcome).type).toBe("error");
      expect(getOfflineActivity().bulk).toBeNull();
    },
  );
});
