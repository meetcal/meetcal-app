import React from "react";
import { act, create } from "react-test-renderer";
import AthleteResultsScreen from "@/app/shared-screens/athlete-results";
import type { AthleteLookup, AthleteMeetResult } from "@/data/types/athletes";
import { getAllCachedLiftingResultsForAthlete } from "@/lib/database/athlete-history-store";

jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));

let mockName = "First Athlete";
// Gating is covered by premium-screens-gated.test.tsx; this file tests the content.
jest.mock("@/components/ui/SubscriptionGate", () => ({
  SubscriptionGate: ({ children }: { children: React.ReactNode }) => children,
}));
let mockLifter: string | undefined;
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ name: mockName, lifter: mockLifter }),
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("@/components/athlete-results/RateBar", () => ({ RateBar: () => null }));
jest.mock("react-native-reanimated", () => ({
  __esModule: true, default: { View: require("react-native").View },
  FadeIn: { duration: () => ({}) },
}));
// Renders the header and every row, so what a row shows (PR badges) and the
// header (status note, success rates) can be asserted.
jest.mock("@shopify/flash-list", () => {
  const { View } = require("react-native");
  return {
    FlashList: (props: {
      data: unknown[];
      ListHeaderComponent?: React.ReactNode;
      renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
    }) => (
      <View>
        {props.ListHeaderComponent}
        {props.data.map((item, index) => (
          <View key={index}>{props.renderItem({ item, index })}</View>
        ))}
      </View>
    ),
  };
});
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/lib/database/athlete-history-store", () => ({
  getAllCachedLiftingResultsForAthlete: jest.fn(async () => []),
}));
const mockFetchRows = jest.fn<Promise<AthleteMeetResult[]>, [string]>();
let mockChoice: AthleteLookup | null = null;
jest.mock("@/lib/database/queries", () => ({
  fetchAthleteResults: async (request: { name: string }): Promise<AthleteLookup> => {
    if (mockChoice) return mockChoice;
    const rows = await mockFetchRows(request.name);
    const best = rows.length > 0 ? 0 : -1;
    return { kind: "results", lifter: null, rows, prs: { snatch: best, cj: best, total: best } };
  },
}));
let mockNetworkListeners: ((isConnected: boolean) => void)[] = [];
jest.mock("@/lib/networkUtils", () => ({
  subscribeToNetworkChanges: (listener: (isConnected: boolean) => void) => {
    mockNetworkListeners.push(listener);
    return () => {
      mockNetworkListeners = mockNetworkListeners.filter((l) => l !== listener);
    };
  },
}));
jest.mock("@/lib/data/mutable-resource", () => ({ reconnectRefetchDelayMs: () => 0 }));
let mockIsOffline = true;
jest.mock("@/hooks/useIsOffline", () => ({ useIsOffline: () => [mockIsOffline, () => {}] }));
jest.mock("@/components/ui/EmptyState", () => {
  const { Pressable, Text, View } = require("react-native");
  return {
    EmptyState: (props: { title: string; message?: string; actionLabel?: string; onActionPress?: () => void }) => (
      <View>
        <Text>{props.title}</Text>
        <Text>{props.message}</Text>
        {props.actionLabel ? (
          <Pressable testID="empty-state-action" onPress={props.onActionPress}>
            <Text>{props.actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    ),
  };
});

// Regression: a failed load (offline) said "No meet results found for …",
// which reads as "this athlete has never competed", with no way to retry.
it("does not display the previous athlete's history when the next athlete fails to load", async () => {
  const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
  jest.mocked(mockFetchRows)
    .mockResolvedValueOnce([{ name: mockName, date: "2026-06-20", total: 100 }] as Awaited<ReturnType<typeof mockFetchRows>>)
    .mockRejectedValueOnce(new Error("Offline"));
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<AthleteResultsScreen />); });
  mockName = "Second Athlete";
  await act(async () => { tree.update(<AthleteResultsScreen />); });
  const rendered = JSON.stringify(tree.toJSON());
  expect(rendered).not.toContain("First Athlete");
  expect(rendered).not.toContain("No meet results found for");
  expect(rendered).toContain("You're offline");
  expect(rendered).toContain("Retry");
  await act(async () => { tree.unmount(); });
  errorLog.mockRestore();
});

it("retries a failed load and shows the results once it succeeds", async () => {
  const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
  mockIsOffline = false;
  mockName = "Retry Athlete";
  jest.mocked(mockFetchRows)
    .mockRejectedValueOnce(new Error("MeetCal API error 503"))
    .mockResolvedValueOnce([]);
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<AthleteResultsScreen />); });
  expect(JSON.stringify(tree.toJSON())).toContain("Couldn't load the results");

  await act(async () => {
    tree.root.findByProps({ testID: "empty-state-action" }).props.onPress();
  });

  // The API answered this time: an empty answer really is "no results".
  expect(mockFetchRows).toHaveBeenLastCalledWith("Retry Athlete");
  expect(JSON.stringify(tree.toJSON())).toContain("No meet results found for");
  await act(async () => { tree.unmount(); });
  errorLog.mockRestore();
  mockIsOffline = true;
});

it("ignores a previous athlete's response after changing the route", async () => {
  mockName = "Slow Athlete";
  let resolveFirst!: (value: Awaited<ReturnType<typeof mockFetchRows>>) => void;
  jest.mocked(mockFetchRows)
    .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
    .mockResolvedValueOnce([]);
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<AthleteResultsScreen />); });
  mockName = "Current Athlete";
  await act(async () => { tree.update(<AthleteResultsScreen />); });
  await act(async () => {
    resolveFirst([{ name: "Slow Athlete", date: "2026-06-20", total: 100 }] as Awaited<ReturnType<typeof mockFetchRows>>);
  });
  expect(JSON.stringify(tree.toJSON())).toContain("No meet results found for");
  expect(JSON.stringify(tree.toJSON())).toContain("Current Athlete");
  await act(async () => { tree.unmount(); });
});

// Regression (#312): offline, with the request failed, one cached meet was
// shown as the whole career: PR badges on every lift, success rates from one
// meet, and nothing saying the history was partial.
it("marks an on-device history as partial and hides PRs and success rates", async () => {
  mockIsOffline = true;
  mockName = "Cached Athlete";
  const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
  jest.mocked(getAllCachedLiftingResultsForAthlete).mockResolvedValueOnce([
    { name: mockName, meet: "Cached Open", date: "2026-06-20", snatch_best: 90, cj_best: 110, total: 200 },
  ] as Awaited<ReturnType<typeof getAllCachedLiftingResultsForAthlete>>);
  jest.mocked(mockFetchRows).mockRejectedValueOnce(new Error("Offline"));
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<AthleteResultsScreen />); });

  const rendered = JSON.stringify(tree.toJSON());
  expect(rendered).toContain("Cached Open");
  expect(rendered).toContain("Offline. Showing downloaded data.");
  expect(rendered).not.toContain("Success Rates");
  expect(rendered).not.toContain('"PR"');
  await act(async () => { tree.unmount(); });
  errorLog.mockRestore();
});

it("shows PRs and success rates, with no partial note, from the API history", async () => {
  mockName = "Online Athlete";
  jest.mocked(mockFetchRows).mockResolvedValueOnce([
    { name: mockName, meet: "API Open", date: "2026-06-20", snatch_best: 90, cj_best: 110, total: 200 },
  ] as Awaited<ReturnType<typeof mockFetchRows>>);
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<AthleteResultsScreen />); });

  const rendered = JSON.stringify(tree.toJSON());
  expect(rendered).toContain("API Open");
  expect(rendered).toContain("Success Rates");
  expect(rendered).toContain('"PR"');
  expect(tree.root.findAllByProps({ testID: "athlete-results-partial-status" })).toHaveLength(0);
  await act(async () => { tree.unmount(); });
});

type ResultRows = Awaited<ReturnType<typeof mockFetchRows>>;
const cachedRow = (name: string) =>
  [{ name, meet: "Cached Open", date: "2026-06-20", snatch_best: 90, cj_best: 110, total: 200 }] as ResultRows;
const apiRows = (name: string) =>
  [
    { name, meet: "Cached Open", date: "2026-06-20", snatch_best: 90, cj_best: 110, total: 200 },
    { name, meet: "Earlier Open", date: "2025-06-20", snatch_best: 85, cj_best: 105, total: 190 },
  ] as ResultRows;

it("loads the full history from the partial note's Retry, keeping the on-device rows up meanwhile", async () => {
  mockIsOffline = false;
  mockName = "Retry Partial Athlete";
  const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
  jest.mocked(getAllCachedLiftingResultsForAthlete).mockResolvedValue(cachedRow(mockName));
  jest.mocked(mockFetchRows).mockRejectedValueOnce(new Error("MeetCal API error 503"));
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<AthleteResultsScreen />); });
  expect(JSON.stringify(tree.toJSON())).toContain("Full history unavailable.");

  let resolveFull!: (rows: ResultRows) => void;
  jest.mocked(mockFetchRows).mockReturnValueOnce(new Promise((resolve) => { resolveFull = resolve; }));
  await act(async () => {
    tree.root.findByProps({ testID: "athlete-results-partial-retry" }).props.onPress();
  });
  // Still on screen while the retry runs: no blank list behind a spinner.
  expect(JSON.stringify(tree.toJSON())).toContain("Cached Open");

  await act(async () => { resolveFull(apiRows(mockName)); });
  const rendered = JSON.stringify(tree.toJSON());
  expect(rendered).toContain("Earlier Open");
  expect(rendered).toContain("Success Rates");
  expect(rendered).toContain('"PR"');
  expect(tree.root.findAllByProps({ testID: "athlete-results-partial-status" })).toHaveLength(0);
  await act(async () => { tree.unmount(); });
  jest.mocked(getAllCachedLiftingResultsForAthlete).mockResolvedValue([]);
  errorLog.mockRestore();
  mockIsOffline = true;
});

// The Retry used to re-read the device: with the download removed meanwhile
// it found nothing, so a failed request dropped the Retry (and an empty
// answer would have cleared the rows still on screen).
it("keeps the on-device rows and the Retry when a retry fails after the download is gone", async () => {
  mockIsOffline = false;
  mockName = "Retry Removed Athlete";
  const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
  jest.mocked(getAllCachedLiftingResultsForAthlete).mockResolvedValue(cachedRow(mockName));
  jest.mocked(mockFetchRows).mockRejectedValueOnce(new Error("MeetCal API error 503"));
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<AthleteResultsScreen />); });

  jest.mocked(getAllCachedLiftingResultsForAthlete).mockResolvedValue([]);
  jest.mocked(mockFetchRows).mockRejectedValueOnce(new Error("MeetCal API error 503"));
  await act(async () => {
    tree.root.findByProps({ testID: "athlete-results-partial-retry" }).props.onPress();
  });

  expect(JSON.stringify(tree.toJSON())).toContain("Cached Open");
  expect(tree.root.findAllByProps({ testID: "athlete-results-partial-retry" }).length).toBeGreaterThan(0);
  await act(async () => { tree.unmount(); });
  errorLog.mockRestore();
  mockIsOffline = true;
});

it("loads the full history when the connection comes back", async () => {
  mockName = "Reconnect Athlete";
  const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
  jest.mocked(getAllCachedLiftingResultsForAthlete).mockResolvedValue(cachedRow(mockName));
  jest.mocked(mockFetchRows).mockRejectedValueOnce(new Error("Offline"));
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<AthleteResultsScreen />); });
  expect(JSON.stringify(tree.toJSON())).toContain("Offline. Showing downloaded data.");

  jest.mocked(mockFetchRows).mockResolvedValueOnce(apiRows(mockName));
  await act(async () => {
    mockNetworkListeners.forEach((listener) => listener(false));
    mockNetworkListeners.forEach((listener) => listener(true));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => { await new Promise<void>((resolve) => setImmediate(resolve)); });

  expect(mockFetchRows).toHaveBeenLastCalledWith("Reconnect Athlete");
  const rendered = JSON.stringify(tree.toJSON());
  expect(rendered).toContain("Earlier Open");
  expect(rendered).toContain("Success Rates");
  expect(tree.root.findAllByProps({ testID: "athlete-results-partial-status" })).toHaveLength(0);
  await act(async () => { tree.unmount(); });
  jest.mocked(getAllCachedLiftingResultsForAthlete).mockResolvedValue([]);
  errorLog.mockRestore();
});

it("offers the lifters of a shared name and opens the one chosen, or the results no lifter holds", async () => {
  mockIsOffline = false;
  mockName = "Taylor Johnson";
  mockChoice = {
    kind: "choose",
    name: "Taylor Johnson",
    lifters: [
      { id: "24655", name: "Taylor Johnson", label: "Age 18 · Barbell Club", results: 2, latestDate: "2025-06-01" },
      { id: "20730", name: "Taylor Johnson", label: "Age 37 · Tennessee-Kentucky", results: 1, latestDate: "2016-03-19" },
    ],
    otherResults: 3,
  };
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<AthleteResultsScreen />); });
  const rendered = JSON.stringify(tree.toJSON());
  expect(rendered).toContain("Age 18 · Barbell Club");
  expect(rendered).toContain("Age 37 · Tennessee-Kentucky");
  expect(rendered).toContain("Other Results For This Name");
  expect(rendered).toContain("3 Results");

  const rows = tree.root.findAll((node) => node.props.accessibilityRole === "button" && typeof node.props.onPress === "function" && typeof node.type !== "string");
  await act(async () => { rows[1]?.props.onPress(); });
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/shared-screens/athlete-results", params: { name: "Taylor Johnson", lifter: "20730" } });
  await act(async () => { rows[2]?.props.onPress(); });
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/shared-screens/athlete-results", params: { name: "Taylor Johnson", other: "1" } });
  await act(async () => { tree.unmount(); });
  mockChoice = null;
  mockIsOffline = true;
});

it("shows only the chosen lifter's downloaded results while offline", async () => {
  mockIsOffline = true;
  mockName = "Shared Offline";
  mockLifter = "20730";
  const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
  jest.mocked(getAllCachedLiftingResultsForAthlete).mockResolvedValueOnce([
    { name: mockName, meet: "Their Open", date: "2026-06-20", total: 200, lifter_id: "20730" },
    { name: mockName, meet: "Someone Else Open", date: "2026-05-20", total: 150, lifter_id: "24655" },
  ] as AthleteMeetResult[]);
  mockFetchRows.mockRejectedValueOnce(new Error("Offline"));
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<AthleteResultsScreen />); });
  const rendered = JSON.stringify(tree.toJSON());
  expect(rendered).toContain("Their Open");
  expect(rendered).not.toContain("Someone Else Open");
  await act(async () => { tree.unmount(); });
  mockLifter = undefined;
  errorLog.mockRestore();
});
