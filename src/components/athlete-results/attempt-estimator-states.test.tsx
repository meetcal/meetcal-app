/**
 * What the attempt estimator shows while and after it loads: cached estimates
 * straight away with the network refresh behind them, and an empty or error
 * state with Retry instead of a bare disclaimer card.
 */
import React from "react";
import { Animated, Pressable, ScrollView, Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import AttemptEstimatorScreen from "@/app/shared-screens/attempt-estimator";
import {
  fetchAthletesWithSession,
  fetchRecentAthleteHistoryForNames,
} from "@/lib/database/queries";
import {
  getAllCachedLiftingResultsForAthletes,
  getSessionAthletesFromMeetCache,
} from "@/lib/database/offline-store";
import { isNetworkAvailable } from "@/lib/networkUtils";

// See attempt-estimator-route.test.tsx: charge the lazy getters to the file.
void [Animated, Pressable, ScrollView];

jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ meet: "test-meet", sessionNumber: "1", platform: "Red" }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("@/lib/database/offline-store", () => ({
  getSessionAthletesFromMeetCache: jest.fn(async () => []),
  getAllCachedLiftingResultsForAthletes: jest.fn(async () => ({})),
  saveSessionAthletes: jest.fn(async () => {}),
}));
jest.mock("@/lib/database/queries", () => ({
  fetchAthletesWithSession: jest.fn(),
  fetchRecentAthleteHistoryForNames: jest.fn(async () => []),
}));
jest.mock("@/lib/networkUtils", () => ({ isNetworkAvailable: jest.fn(async () => true) }));

const athlete = (name: string) => ({
  memberId: name,
  name,
  age: 25,
  club: "Club",
  gender: "Men",
  weightClass: "89kg",
  entryTotal: 250,
  adaptive: false,
  session: { number: 1, platform: "Red" as const },
});

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  });
};

function textOf(tree: ReactTestRenderer): string {
  return tree.root
    .findAllByType(Text)
    .map((node) => {
      const { children } = node.props as { children?: unknown };
      return Array.isArray(children) ? children.join("") : String(children ?? "");
    })
    .join("\n");
}

async function render(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<AttemptEstimatorScreen />);
  });
  await flush();
  return tree;
}

describe("attempt estimator states", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(isNetworkAvailable).mockResolvedValue(true);
    jest.mocked(getSessionAthletesFromMeetCache).mockResolvedValue([]);
    jest.mocked(getAllCachedLiftingResultsForAthletes).mockResolvedValue({});
  });

  it("shows cached estimates while the network refresh is still running", async () => {
    jest.mocked(getSessionAthletesFromMeetCache).mockResolvedValue([athlete("Cached Lifter")]);
    jest.mocked(fetchAthletesWithSession).mockReturnValue(new Promise(() => {}));

    const tree = await render();

    expect(textOf(tree)).toContain("Cached Lifter");
    expect(textOf(tree)).toContain("Refreshing");
    act(() => tree.unmount());
  });

  it("keeps cached estimates and says so when the refresh fails", async () => {
    jest.mocked(getSessionAthletesFromMeetCache).mockResolvedValue([athlete("Cached Lifter")]);
    jest.mocked(fetchAthletesWithSession).mockRejectedValue(new Error("timeout"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    const tree = await render();

    expect(textOf(tree)).toContain("Cached Lifter");
    expect(textOf(tree)).toContain("Couldn't refresh");
    expect(textOf(tree)).not.toContain("Refreshing");
    act(() => tree.unmount());
  });

  it("shows an error with Retry when nothing is cached and the fetch fails", async () => {
    jest.mocked(fetchAthletesWithSession).mockRejectedValueOnce(new Error("timeout"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    const tree = await render();
    expect(textOf(tree)).toContain("Couldn't load estimates");

    jest.mocked(fetchAthletesWithSession).mockResolvedValueOnce([athlete("Fresh Lifter")]);
    const retry = tree.root.findByProps({ accessibilityLabel: "Retry loading estimates" });
    await act(async () => {
      retry.props.onPress();
    });
    await flush();

    expect(fetchAthletesWithSession).toHaveBeenCalledTimes(2);
    expect(fetchRecentAthleteHistoryForNames).toHaveBeenCalledWith(
      ["Fresh Lifter"],
      expect.any(String),
    );
    expect(textOf(tree)).toContain("Fresh Lifter");
    expect(textOf(tree)).not.toContain("Couldn't load estimates");
    act(() => tree.unmount());
  });

  it("says the session is empty instead of showing only the disclaimer", async () => {
    jest.mocked(fetchAthletesWithSession).mockResolvedValue([]);

    const tree = await render();

    expect(textOf(tree)).toContain("No athletes in this session");
    expect(tree.root.findAllByProps({ accessibilityLabel: "Retry loading estimates" }).length)
      .toBeGreaterThan(0);
    act(() => tree.unmount());
  });

  it("explains an offline session that was never downloaded", async () => {
    jest.mocked(isNetworkAvailable).mockResolvedValue(false);

    const tree = await render();

    expect(textOf(tree)).toContain("You're offline");
    expect(fetchAthletesWithSession).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("marks each athlete row with its expanded state", async () => {
    jest.mocked(fetchAthletesWithSession).mockResolvedValue([athlete("Row Lifter")]);

    const tree = await render();
    const row = () =>
      tree.root.find(
        (node) =>
          node.props.accessibilityRole === "button" &&
          node.props.accessibilityState?.expanded !== undefined &&
          typeof node.props.onPress === "function",
      );
    expect(row().props.accessibilityState).toEqual({ expanded: false });

    await act(async () => {
      row().props.onPress();
    });
    expect(row().props.accessibilityState).toEqual({ expanded: true });
    act(() => tree.unmount());
  });
});
