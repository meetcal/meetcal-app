import React from "react";
import { act, create } from "react-test-renderer";
import AthleteResultsScreen from "@/app/shared-screens/athlete-results";
import { fetchAllResultsForName } from "@/lib/database/queries";

jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));

let mockName = "First Athlete";
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

it("does not display the previous athlete's history when the next athlete fails to load", async () => {
  const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
  jest.mocked(fetchAllResultsForName)
    .mockResolvedValueOnce([{ name: mockName, date: "2026-06-20", total: 100 }] as Awaited<ReturnType<typeof fetchAllResultsForName>>)
    .mockRejectedValueOnce(new Error("Offline"));
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<AthleteResultsScreen />); });
  mockName = "Second Athlete";
  await act(async () => { tree.update(<AthleteResultsScreen />); });
  expect(JSON.stringify(tree.toJSON())).toContain("No meet results found for");
  expect(JSON.stringify(tree.toJSON())).toContain("Second Athlete");
  await act(async () => { tree.unmount(); });
  errorLog.mockRestore();
});
