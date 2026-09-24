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
