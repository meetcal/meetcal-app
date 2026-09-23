import React from "react";
import { act, create } from "react-test-renderer";
import AttemptEstimatorScreen from "@/app/shared-screens/attempt-estimator";
import { fetchAthletesWithSession, fetchRecentAthleteHistoryForNames } from "@/lib/database/queries";
import { saveMeetAthletes } from "@/lib/database/offline-store";

jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ meet: "test-meet", sessionNumber: "1", platform: "Red" }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/lib/database/offline-store", () => ({
  getSessionAthletesFromMeetCache: jest.fn(async () => []),
  saveMeetAthletes: jest.fn(async () => {}),
}));
jest.mock("@/lib/database/queries", () => ({
  fetchAthletesWithSession: jest.fn(),
  fetchRecentAthleteHistoryForNames: jest.fn(),
}));
jest.mock("@/lib/networkUtils", () => ({ isNetworkAvailable: jest.fn(async () => true) }));

it("does not begin a meet-wide history download after leaving the estimator", async () => {
  let resolveAthletes!: (value: Awaited<ReturnType<typeof fetchAthletesWithSession>>) => void;
  jest.mocked(fetchAthletesWithSession).mockReturnValueOnce(new Promise((resolve) => {
    resolveAthletes = resolve;
  }));
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<AttemptEstimatorScreen />); });
  expect(fetchAthletesWithSession).toHaveBeenCalledTimes(1);
  await act(async () => { tree.unmount(); });
  await act(async () => {
    resolveAthletes([{ name: "Athlete", memberId: "1" }] as Awaited<ReturnType<typeof fetchAthletesWithSession>>);
  });
  expect(saveMeetAthletes).not.toHaveBeenCalled();
  expect(fetchRecentAthleteHistoryForNames).not.toHaveBeenCalled();
});
