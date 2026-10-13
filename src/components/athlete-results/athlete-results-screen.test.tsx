import React from "react";
import { act, create } from "react-test-renderer";
import AthleteResultsScreen from "@/app/shared-screens/athlete-results";
import { fetchAllResultsForName } from "@/lib/database/queries";

jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));

let mockName = "First Athlete";
// Gating is covered by premium-screens-gated.test.tsx; this file tests the content.
jest.mock("@/components/ui/SubscriptionGate", () => ({
  SubscriptionGate: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ name: mockName }),
}));
jest.mock("@/components/athlete-results/RateBar", () => ({ RateBar: () => null }));
jest.mock("react-native-reanimated", () => ({
  __esModule: true, default: { View: require("react-native").View },
  FadeIn: { duration: () => ({}) },
}));
jest.mock("@shopify/flash-list", () => ({ FlashList: () => null }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/lib/database/offline-store", () => ({
  getAllCachedLiftingResultsForAthlete: jest.fn(async () => []),
}));
jest.mock("@/lib/database/queries", () => ({ fetchAllResultsForName: jest.fn() }));
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
  jest.mocked(fetchAllResultsForName)
    .mockResolvedValueOnce([{ name: mockName, date: "2026-06-20", total: 100 }] as Awaited<ReturnType<typeof fetchAllResultsForName>>)
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
  jest.mocked(fetchAllResultsForName)
    .mockRejectedValueOnce(new Error("MeetCal API error 503"))
    .mockResolvedValueOnce([]);
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<AthleteResultsScreen />); });
  expect(JSON.stringify(tree.toJSON())).toContain("Couldn't load the results");

  await act(async () => {
    tree.root.findByProps({ testID: "empty-state-action" }).props.onPress();
  });

  // The API answered this time: an empty answer really is "no results".
  expect(fetchAllResultsForName).toHaveBeenLastCalledWith("Retry Athlete");
  expect(JSON.stringify(tree.toJSON())).toContain("No meet results found for");
  await act(async () => { tree.unmount(); });
  errorLog.mockRestore();
  mockIsOffline = true;
});

it("ignores a previous athlete's response after changing the route", async () => {
  mockName = "Slow Athlete";
  let resolveFirst!: (value: Awaited<ReturnType<typeof fetchAllResultsForName>>) => void;
  jest.mocked(fetchAllResultsForName)
    .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
    .mockResolvedValueOnce([]);
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<AthleteResultsScreen />); });
  mockName = "Current Athlete";
  await act(async () => { tree.update(<AthleteResultsScreen />); });
  await act(async () => {
    resolveFirst([{ name: "Slow Athlete", date: "2026-06-20", total: 100 }] as Awaited<ReturnType<typeof fetchAllResultsForName>>);
  });
  expect(JSON.stringify(tree.toJSON())).toContain("No meet results found for");
  expect(JSON.stringify(tree.toJSON())).toContain("Current Athlete");
  await act(async () => { tree.unmount(); });
});
