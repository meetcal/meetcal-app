/**
 * The offline screen wired end to end: the real `useOfflineData` hook, the
 * real screen and the real `DownloadRow`. Only the network / storage layer
 * below the hook is stubbed. `utils/offline.test.tsx` proves the hook's busy
 * guards; this proves the screen hands them to every row and header action,
 * and that each row's closure acts on its own meet or table.
 */
import React from "react";
import { Alert } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import OfflineDataScreen from "@/app/schedule-toolbar/offline-data";
import DownloadRow from "@/components/offline/DownloadRow";
import { OFFLINE_CACHE_KEYS } from "@/lib/database/offline-cache";

jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("@/app/shared-screens/paywall", () => {
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return { __esModule: true, default: () => <Text>Paywall</Text> };
});

type HeaderItem = { label: string; disabled: boolean; onPress: () => void };
type ScreenOptions = { unstable_headerRightItems?: () => HeaderItem[] };
let mockScreenOptions: ScreenOptions = {};
jest.mock("expo-router", () => ({
  Stack: {
    Screen: ({ options }: { options: ScreenOptions }) => {
      mockScreenOptions = options;
      return null;
    },
  },
}));

let mockIsSubscribed = true;
jest.mock("@/contexts/SubscriptionContext", () => ({
  useSubscription: () => ({ isSubscribed: mockIsSubscribed, isLoading: false }),
}));

// "Today" in the download window's zone, so the window does not depend on
// the day the suite runs.
jest.mock("@/utils/dateTime", () => ({
  ...jest.requireActual("@/utils/dateTime"),
  getCalendarDateInTimeZone: () => "2099-06-15",
}));

const MEETS = [
  { name: "Meet A", dates: { start: "2099-06-20", end: "2099-06-22" } },
  { name: "Meet B", dates: { start: "2099-07-01", end: "2099-07-02" } },
  // Outside the 21-day window: never offered.
  { name: "Meet Far", dates: { start: "2099-09-01", end: "2099-09-02" } },
];
jest.mock("@/contexts/SelectedMeetContext", () => ({
  useSelectedMeet: () => ({ availableMeets: MEETS, isLoading: false }),
}));

jest.mock("@/lib/networkUtils", () => ({ isNetworkAvailable: async () => true }));

const mockDownloadStandards = jest.fn(async () => {});
jest.mock("@/lib/database/fetch-standards", () => ({
  downloadStandardsForOffline: () => mockDownloadStandards(),
}));
jest.mock("@/lib/database/fetch-qualifying-totals", () => ({
  downloadQualifyingTotalsForOffline: jest.fn(async () => {}),
}));
jest.mock("@/lib/database/fetch-adaptive-records", () => ({
  downloadAdaptiveRecordsForOffline: jest.fn(async () => {}),
}));
jest.mock("@/lib/database/fetch-records", () => ({
  downloadRecordsForOffline: jest.fn(async () => {}),
}));
jest.mock("@/lib/database/fetch-wso-records", () => ({
  downloadWSORecordsForOffline: jest.fn(async () => {}),
}));
jest.mock("@/lib/database/fetchIntlRankings", () => ({
  downloadIntlRankingsForOffline: jest.fn(async () => {}),
}));

const mockPrefetchMeetData = jest.fn(async (_meet: string, _options?: unknown) => {});
jest.mock("@/lib/database/meet-manager", () => ({
  prefetchMeetData: (meet: string, options?: unknown) => mockPrefetchMeetData(meet, options),
}));

let mockDownloadedMeets = new Set<string>();
const mockClearMeetData = jest.fn(async (meet: string, _options?: unknown) => {
  mockDownloadedMeets.delete(meet);
});
const mockMarkMeetExplicitlyDownloaded = jest.fn(
  async (meet: string, downloaded: boolean, _options?: unknown) => {
    if (downloaded) mockDownloadedMeets.add(meet);
  },
);
jest.mock("@/lib/database/offline-store", () => ({
  clearAllAthleteHistory: jest.fn(async () => {}),
  clearMeetData: (meet: string, options?: unknown) => mockClearMeetData(meet, options),
  getExplicitlyDownloadedMeetIds: async () => new Set(mockDownloadedMeets),
  getLastSyncTime: async () => Date.UTC(2099, 5, 1),
  markMeetExplicitlyDownloaded: (meet: string, downloaded: boolean, options?: unknown) =>
    mockMarkMeetExplicitlyDownloaded(meet, downloaded, options),
  readStorageKeysForMeetClear: jest.fn(async () => []),
}));

type AlertButton = { text: string; onPress?: () => unknown };
let alertSpy: jest.SpyInstance;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
};

async function mount() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<OfflineDataScreen />);
  });
  await flush();
  return tree;
}

function rows(tree: ReactTestRenderer) {
  return tree.root.findAllByType(DownloadRow);
}

function row(tree: ReactTestRenderer, title: string) {
  return tree.root.findAll(
    (node) => node.type === DownloadRow && node.props.title === title,
  )[0];
}

/** What the user can tap: the row's own Pressable, not the prop passed in. */
function rowPressable(tree: ReactTestRenderer, title: string) {
  return pressableIn(row(tree, title));
}

function pressableIn(node: ReturnType<typeof row>) {
  const pressable = node.findAll((n) => n !== node && typeof n.props.onPress === "function")[0];
  if (!pressable) throw new Error("row has no pressable");
  return pressable;
}

async function pressRow(tree: ReactTestRenderer, title: string) {
  const pressable = rowPressable(tree, title);
  if (pressable.props.disabled) return;
  await act(async () => {
    await pressable.props.onPress();
  });
  await flush();
}

function headerItem(label: string): HeaderItem {
  const item = mockScreenOptions.unstable_headerRightItems?.().find((i) => i.label === label);
  if (!item) throw new Error(`no header item ${label}`);
  return item;
}

function lastAlertButtons(): AlertButton[] {
  return alertSpy.mock.calls.at(-1)?.[2] as AlertButton[];
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockIsSubscribed = true;
  mockScreenOptions = {};
  mockDownloadedMeets = new Set(["Meet A"]);
  mockPrefetchMeetData.mockImplementation(async () => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  await AsyncStorage.clear();
  await AsyncStorage.setItem(
    OFFLINE_CACHE_KEYS.standards,
    JSON.stringify({ data: { any: "rows" }, lastSynced: Date.UTC(2099, 5, 1) }),
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("OfflineDataScreen", () => {
  it("lists the meets in the download window and every competition table", async () => {
    const tree = await mount();
    const titles = rows(tree).map((r) => r.props.title);
    expect(titles.slice(0, 2)).toEqual(["Meet A", "Meet B"]);
    expect(titles).not.toContain("Meet Far");
    expect(titles).toHaveLength(2 + 6);
    expect(row(tree, "Meet A").props.isDownloaded).toBe(true);
    expect(row(tree, "Meet B").props.isDownloaded).toBe(false);
    expect(row(tree, "A/B Standards").props.isDownloaded).toBe(true);
    act(() => tree.unmount());
  });

  it("disables every row and both header actions while Refresh All runs, then re-enables them", async () => {
    const gate = deferred();
    mockPrefetchMeetData.mockImplementation(() => gate.promise);
    const tree = await mount();
    for (const r of rows(tree)) {
      expect(pressableIn(r).props.disabled).toBe(false);
    }

    act(() => headerItem("Refresh all offline data").onPress());
    await act(async () => {
      void lastAlertButtons().find((b) => b.text === "Refresh All")?.onPress?.();
      await new Promise((r) => setTimeout(r, 0));
    });

    // Mid-refresh: a row tap would race the refresh that already listed it.
    expect(mockPrefetchMeetData).toHaveBeenCalledWith("Meet A", { forceHistoryRefresh: true });
    for (const r of rows(tree)) {
      const pressable = pressableIn(r);
      expect(pressable.props.disabled).toBe(true);
      expect(pressable.props.accessibilityState).toEqual({ disabled: true });
    }
    expect(headerItem("Refresh all offline data").disabled).toBe(true);
    expect(headerItem("Delete all offline data").disabled).toBe(true);

    const alertsBefore = alertSpy.mock.calls.length;
    await pressRow(tree, "Meet B");
    await pressRow(tree, "A/B Standards");
    expect(alertSpy.mock.calls.length).toBe(alertsBefore);
    expect(mockPrefetchMeetData).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate.resolve();
    });
    await flush();

    expect(alertSpy.mock.calls.at(-1)?.[0]).toBe("Refresh Complete");
    for (const r of rows(tree)) {
      expect(pressableIn(r).props.disabled).toBe(false);
    }
    expect(headerItem("Refresh all offline data").disabled).toBe(false);
    act(() => tree.unmount());
  });

  it("a meet row downloads that meet, marks it with its end date and shows it downloaded", async () => {
    const tree = await mount();

    await pressRow(tree, "Meet B");

    // A first download is not a forced history refresh.
    expect(mockPrefetchMeetData.mock.calls).toEqual([["Meet B", undefined]]);
    expect(mockMarkMeetExplicitlyDownloaded).toHaveBeenCalledWith("Meet B", true, {
      endDate: "2099-07-02",
    });
    expect(row(tree, "Meet B").props.isDownloaded).toBe(true);
    expect(row(tree, "Meet B").props.isDownloading).toBe(false);
    act(() => tree.unmount());
  });

  it("a downloaded row asks before removing, and removes only that meet", async () => {
    const tree = await mount();

    await pressRow(tree, "Meet A");
    expect(alertSpy.mock.calls.at(-1)?.[0]).toBe("Remove Download");
    expect(alertSpy.mock.calls.at(-1)?.[1]).toContain("Meet A");
    expect(mockClearMeetData).not.toHaveBeenCalled();

    await act(async () => {
      await lastAlertButtons().find((b) => b.text === "Remove")?.onPress?.();
    });
    await flush();

    expect(mockClearMeetData.mock.calls).toEqual([["Meet A", undefined]]);
    expect(row(tree, "Meet A").props.isDownloaded).toBe(false);
    expect(row(tree, "Meet B").props.isDownloaded).toBe(false);
    act(() => tree.unmount());
  });

  it("a competition row downloads its own table", async () => {
    await AsyncStorage.removeItem(OFFLINE_CACHE_KEYS.standards);
    const tree = await mount();
    expect(row(tree, "A/B Standards").props.isDownloaded).toBe(false);

    await pressRow(tree, "A/B Standards");

    expect(mockDownloadStandards).toHaveBeenCalledTimes(1);
    expect(mockPrefetchMeetData).not.toHaveBeenCalled();
    expect(mockMarkMeetExplicitlyDownloaded).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("shows the paywall instead of any download action when not subscribed", async () => {
    mockIsSubscribed = false;
    const tree = await mount();
    expect(rows(tree)).toHaveLength(0);
    expect(JSON.stringify(tree.toJSON())).toContain("Paywall");
    act(() => tree.unmount());
  });
});
