// Lives outside app/: Expo Router turns every file under app/ into a route,
// so a test there was bundled into the app (react-test-renderer, jest.mock).
import React from "react";
import { Animated, Pressable, ScrollView } from "react-native";
import { act, create } from "react-test-renderer";
import AttemptEstimatorScreen from "@/app/shared-screens/attempt-estimator";
import {
  fetchAthletesWithSession,
  fetchRecentAthleteHistoryForNames,
} from "@/lib/database/queries";
import {
  saveAthleteHistory,
  saveMeetAthletes,
  saveSessionAthletes,
} from "@/lib/database/offline-store";
import { ATTEMPT_HISTORY_YEARS, getHistoryCutoffDate } from "@/utils/dateTime";

// react-native's exports are lazy getters. On a cold transform cache (every CI
// run) the first access to `Animated` costs ~2.3s and `ScrollView`/`Pressable`
// ~0.7s more, all inside the first test's render, which pushed that test past
// its 5s budget on CI. Touching them here, at module load, charges the one-time
// cost to the file instead of to whichever test renders first.
void [Animated, Pressable, ScrollView];

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
  saveSessionAthletes: jest.fn(async () => {}),
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

// Drain whole macrotask turns, not a fixed count of microtasks: the load
// chain's await depth changes with the code, and a microtask count that is
// one short fails intermittently rather than loudly.
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
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

    // One request for this session and platform, never the whole roster
    // (~457KB at a national meet), and only this session's cache is written:
    // the roster blob is not re-read, merged and rewritten.
    expect(fetchAthletesWithSession).toHaveBeenCalledTimes(1);
    expect(fetchAthletesWithSession).toHaveBeenCalledWith("test-meet", 1, "Red");
    expect(saveMeetAthletes).not.toHaveBeenCalled();
    expect(saveSessionAthletes).toHaveBeenCalledTimes(1);
    expect(jest.mocked(saveSessionAthletes).mock.calls[0]).toEqual([
      "test-meet",
      1,
      "Red",
      [athlete("Session Lifter A", 1, "Red"), athlete("Session Lifter B", 1, "Red")],
    ]);
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
    // An empty answer never overwrites the cached session.
    expect(saveSessionAthletes).not.toHaveBeenCalled();

    await act(async () => {
      tree.unmount();
    });
  });

  it("still shows fresh estimates when the session cache write fails", async () => {
    jest.mocked(fetchAthletesWithSession).mockResolvedValue([
      athlete("Session Lifter A", 1, "Red"),
    ]);
    jest.mocked(saveSessionAthletes).mockRejectedValueOnce(new Error("SQLITE_FULL"));

    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<AttemptEstimatorScreen />);
    });
    await flush();

    expect(fetchRecentAthleteHistoryForNames).toHaveBeenCalledWith(
      ["Session Lifter A"],
      getHistoryCutoffDate(ATTEMPT_HISTORY_YEARS),
    );
    expect(JSON.stringify(tree.toJSON())).toContain("Session Lifter A");

    await act(async () => {
      tree.unmount();
    });
  });
});
