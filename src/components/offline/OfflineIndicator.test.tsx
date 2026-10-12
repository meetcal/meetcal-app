import React from "react";
import { act, create } from "react-test-renderer";

import {
  isNetworkAvailable,
  subscribeToNetworkChanges,
} from "@/lib/networkUtils";
import { OfflineIndicator } from "./OfflineIndicator";

jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(),
  subscribeToNetworkChanges: jest.fn(),
}));
jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
// A week-old subscription check is not old meet data: the banner must not
// read it at all.
jest.mock("@/contexts/SubscriptionContext", () => ({
  useSubscription: () => ({ isUsingStaleCache: true, lastSyncTimestamp: 1 }),
}));
jest.mock("@/contexts/SelectedMeetContext", () => ({
  useSelectedMeet: () => ({ selectedMeet: "Meet A" }),
}));
const mockGetLastSyncTime = jest.fn<Promise<number | null>, [string]>(async () => null);
jest.mock("@/lib/database/offline-store", () => ({
  getLastSyncTime: (meet: string) => mockGetLastSyncTime(meet),
}));

/** Longer than the banner's own minimum delay, so it is allowed to render. */
const WELL_PAST_BANNER_DELAY_MS = 60 * 1000;

const rendered = (tree: ReturnType<typeof create>) =>
  JSON.stringify(tree.toJSON() ?? null);

let notify: (connected: boolean) => void = () => {};
const unsubscribe = jest.fn();

beforeEach(() => {
  jest.useFakeTimers();
  jest.mocked(isNetworkAvailable).mockReset();
  unsubscribe.mockClear();
  // Reset, not just re-implemented: the call count is asserted, and an
  // earlier test's subscription would otherwise be counted (fails under
  // `--randomize`).
  jest.mocked(subscribeToNetworkChanges).mockReset();
  jest.mocked(subscribeToNetworkChanges).mockImplementation((listener) => {
    notify = listener;
    return unsubscribe;
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("OfflineIndicator", () => {
  // Regression: the banner re-ran a NetInfo reachability probe every 5s for
  // the life of the app. One probe, then the change listener.
  it("probes once and then relies on network change events", async () => {
    jest.mocked(isNetworkAvailable).mockResolvedValue(true);

    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<OfflineIndicator />);
    });
    expect(isNetworkAvailable).toHaveBeenCalledTimes(1);
    expect(subscribeToNetworkChanges).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(WELL_PAST_BANNER_DELAY_MS);
    });
    expect(isNetworkAvailable).toHaveBeenCalledTimes(1);
    expect(rendered(tree)).not.toContain("Offline Mode");

    act(() => {
      notify(false);
    });
    expect(rendered(tree)).toContain("Offline Mode");

    act(() => {
      notify(true);
    });
    expect(rendered(tree)).not.toContain("Offline Mode");

    act(() => {
      tree.unmount();
    });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("stays hidden online even when the subscription cache is stale", async () => {
    jest.mocked(isNetworkAvailable).mockResolvedValue(true);

    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<OfflineIndicator />);
    });
    await act(async () => {
      jest.advanceTimersByTime(WELL_PAST_BANNER_DELAY_MS);
    });

    expect(rendered(tree)).not.toContain("Using Cached Data");
    expect(rendered(tree)).not.toContain("Offline Mode");
    act(() => {
      tree.unmount();
    });
  });

  it("shows how old the selected meet's data is, and never takes touches", async () => {
    jest.mocked(isNetworkAvailable).mockResolvedValue(false);
    mockGetLastSyncTime.mockResolvedValue(Date.now() - 3 * 60 * 60 * 1000);

    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<OfflineIndicator />);
    });
    await act(async () => {
      jest.advanceTimersByTime(WELL_PAST_BANNER_DELAY_MS);
    });

    expect(mockGetLastSyncTime).toHaveBeenCalledWith("Meet A");
    expect(rendered(tree)).toContain("Meet data synced 3h ago");
    expect(tree.toJSON()).toMatchObject({ props: { pointerEvents: "none" } });
    act(() => {
      tree.unmount();
    });
  });

  it("lets a change event that beats the initial probe win", async () => {
    let finishProbe!: (connected: boolean) => void;
    jest.mocked(isNetworkAvailable).mockReturnValue(
      new Promise((resolve) => {
        finishProbe = resolve;
      }),
    );

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<OfflineIndicator />);
    });
    act(() => {
      notify(false);
    });
    await act(async () => {
      jest.advanceTimersByTime(WELL_PAST_BANNER_DELAY_MS);
    });
    expect(rendered(tree)).toContain("Offline Mode");

    // The stale "online" probe answer must not clear the banner.
    await act(async () => {
      finishProbe(true);
    });
    expect(rendered(tree)).toContain("Offline Mode");

    act(() => {
      tree.unmount();
    });
  });
});
