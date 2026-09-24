import React from "react";
import { act, create } from "react-test-renderer";
import AttemptEstimatorScreen from "@/app/shared-screens/attempt-estimator";
import {
  fetchAthletesWithSession,
  fetchRecentAthleteHistoryForNames,
} from "@/lib/database/queries";
import {
  saveAthleteHistory,
  saveMeetAthletes,
} from "@/lib/database/offline-store";
import { ATTEMPT_HISTORY_YEARS, getHistoryCutoffDate } from "@/utils/dateTime";

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
  getAllCachedLiftingResultsForAthletes: jest.fn(async () => ({})),
  saveMeetAthletes: jest.fn(async () => {}),
  saveAthleteHistory: jest.fn(async () => {}),
}));
jest.mock("@/lib/database/queries", () => ({
  fetchAthletesWithSession: jest.fn(),
  fetchRecentAthleteHistoryForNames: jest.fn(async () => []),
}));
jest.mock("@/lib/networkUtils", () => ({ isNetworkAvailable: jest.fn(async () => true) }));

const athlete = (name: string, number: number, platform: "Red" | "Blue") => ({
  memberId: name,
  name,
  age: 25,
  club: "Club",
  gender: "Men",
  weightClass: "89kg",
  entryTotal: 250,
  adaptive: false,
  session: { number, platform },
});

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
};

describe("attempt estimator history fetch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("fetches history for the session's athletes only and never writes the full-history keys", async () => {
    jest.mocked(fetchAthletesWithSession).mockResolvedValue([
      athlete("Session Lifter A", 1, "Red"),
      athlete("Session Lifter B", 1, "Red"),
      athlete("Other Session Lifter", 2, "Blue"),
      athlete("Other Platform Lifter", 1, "Blue"),
    ]);
    const historyRow = { name: "Session Lifter A", date: "2025-06-01" };
    jest.mocked(fetchRecentAthleteHistoryForNames).mockResolvedValue([historyRow as never]);

    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<AttemptEstimatorScreen />);
    });
    await flush();

    // The whole roster is one request (and refreshes the roster cache), but
    // the history request — the expensive one — covers this session only.
    expect(fetchAthletesWithSession).toHaveBeenCalledTimes(1);
    expect(saveMeetAthletes).toHaveBeenCalledTimes(1);
    expect(fetchRecentAthleteHistoryForNames).toHaveBeenCalledTimes(1);
    expect(fetchRecentAthleteHistoryForNames).toHaveBeenCalledWith(
      ["Session Lifter A", "Session Lifter B"],
      getHistoryCutoffDate(ATTEMPT_HISTORY_YEARS),
    );

    // The per-athlete history keys belong to explicit downloads (they mark a
    // download complete and are never evicted); a session window is not one.
    expect(saveAthleteHistory).not.toHaveBeenCalled();

    await act(async () => {
      tree.unmount();
    });
  });

  it("skips the history request when the session has no athletes", async () => {
    jest.mocked(fetchAthletesWithSession).mockResolvedValue([
      athlete("Other Session Lifter", 2, "Blue"),
    ]);

    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<AttemptEstimatorScreen />);
    });
    await flush();

    expect(fetchRecentAthleteHistoryForNames).not.toHaveBeenCalled();
    expect(saveAthleteHistory).not.toHaveBeenCalled();

    await act(async () => {
      tree.unmount();
    });
  });
});
