// Lives outside app/: Expo Router turns every file under app/ into a route.
import React from "react";
import { RefreshControl } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import SessionDetailsScreen from "@/app/shared-screens/schedule-details";
import { showToast } from "@/components/ui/Toast";

const mockRefreshSchedule = jest.fn<Promise<void>, []>();
const mockRefreshAthletes = jest.fn<Promise<boolean>, []>();

jest.mock("@/components/ui/Toast", () => ({ showToast: jest.fn() }));
jest.mock("@/components/schedule-details/HeaderSection", () => () => null);
jest.mock("@/components/schedule-details/SessionAthletes", () => () => null);
jest.mock("@/contexts/SelectedMeetContext", () => ({
  useSelectedMeet: () => ({ selectedMeet: "Test Meet" }),
}));
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));
jest.mock("@/hooks/useScreenInsets", () => ({ useScreenHorizontalInsets: () => ({}) }));
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ meet: "Test Meet", sessionNumber: "4", platform: "Red" }),
}));
jest.mock("@/hooks/useScheduleData", () => ({
  useScheduleData: () => ({ schedule: [], refreshSchedule: mockRefreshSchedule }),
}));
jest.mock("@/hooks/useMeetAthletes", () => ({
  useSessionAthletes: () => ({
    athletes: [],
    isLoading: false,
    isRefreshing: false,
    loadError: null,
    refreshError: null,
    refreshAthletes: mockRefreshAthletes,
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function render(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<SessionDetailsScreen />);
  });
  return tree;
}

const refreshControl = (tree: ReactTestRenderer) => tree.root.findByType(RefreshControl);

describe("session details pull-to-refresh", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRefreshSchedule.mockResolvedValue(undefined);
    mockRefreshAthletes.mockResolvedValue(true);
  });

  // Regression (#315): the spinner stopped once the schedule refreshed,
  // while the athletes refresh (started from an effect) was still running.
  it("keeps the spinner up until the athletes refresh finishes", async () => {
    const athletes = deferred<boolean>();
    mockRefreshAthletes.mockReturnValue(athletes.promise);
    const tree = await render();

    let done!: Promise<void>;
    await act(async () => {
      done = refreshControl(tree).props.onRefresh();
    });
    expect(mockRefreshSchedule).toHaveBeenCalledTimes(1);
    expect(mockRefreshAthletes).toHaveBeenCalledTimes(1);
    expect(refreshControl(tree).props.refreshing).toBe(true);

    await act(async () => {
      athletes.resolve(true);
      await done;
    });
    expect(refreshControl(tree).props.refreshing).toBe(false);
    expect(showToast).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  // Regression (#315): a failed athletes refresh was never shown.
  it("tells the user when the athletes refresh failed", async () => {
    mockRefreshAthletes.mockResolvedValue(false);
    const tree = await render();

    await act(async () => {
      await refreshControl(tree).props.onRefresh();
    });

    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
    expect(refreshControl(tree).props.refreshing).toBe(false);
    act(() => tree.unmount());
  });
});
