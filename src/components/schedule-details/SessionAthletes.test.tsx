import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import SessionAthletes from "@/components/schedule-details/SessionAthletes";
import type { LiftResult } from "@/data/types/athletes";
import type { UseMeetAthletesReturn } from "@/hooks/useMeetAthletes";

jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/hooks/useIsOffline", () => ({ useIsOffline: () => [false, jest.fn()] }));
jest.mock("@/hooks/useRequirePremium", () => ({
  useRequirePremium: () => ({
    requirePremium: jest.fn(),
    requireAuth: jest.fn(),
    access: "denied",
  }),
}));
jest.mock("@/components/schedule-details/sessionSort/SessionSortControl", () => () => null);
jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
// The real Button pulls in reanimated, whose native worklets do not load in Jest.
jest.mock("@/components/ui/Button", () => ({ Button: () => null }));
jest.mock("@/lib/athlete-bests", () => ({
  getAthleteBestsBatch: jest.fn(async () => ({})),
  getCachedAthleteBestsBatch: jest.fn(async () => ({})),
}));

function state(overrides: Partial<UseMeetAthletesReturn> = {}): UseMeetAthletesReturn {
  return {
    athletes: [],
    isLoading: false,
    isRefreshing: false,
    loadError: null,
    refreshError: null,
    refreshAthletes: jest.fn(async () => true),
    ...overrides,
  };
}

async function render(athletesState: UseMeetAthletesReturn): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SessionAthletes
        sessionNumber={4}
        platform="Red"
        meetId="Test Meet"
        athletesState={athletesState}
      />,
    );
  });
  return tree;
}

describe("SessionAthletes card", () => {
  // Regression (#313): with no athletes and no error the card returned
  // null, so it vanished as if the session did not exist.
  it("keeps the card with an empty-state message when the session has no athletes", async () => {
    const tree = await render(state());
    expect(tree.root.findAllByProps({ testID: "session-athletes-empty" })).not.toHaveLength(0);
    expect(tree.toJSON()).not.toBeNull();
    act(() => tree.unmount());
  });

  it("renders nothing without a meet to ask about", async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <SessionAthletes
          sessionNumber={4}
          platform="Red"
          meetId={"" as never}
          athletesState={state()}
        />,
      );
    });
    expect(tree.toJSON()).toBeNull();
    act(() => tree.unmount());
  });

  it("shows the load error, not the empty state, when the load failed", async () => {
    const tree = await render(state({ loadError: "Offline" }));
    expect(tree.root.findAllByProps({ testID: "session-athletes-load-error" })).not.toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: "session-athletes-empty" })).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("lists the athletes it is given", async () => {
    const athlete = {
      memberId: "1", name: "Jane Lifter", age: 25, club: "Club", gender: "Women",
      weightClass: "71kg", entryTotal: 200, adaptive: false,
      session: { number: 4, platform: "Red" },
    } as LiftResult;
    const tree = await render(state({ athletes: [athlete] }));
    expect(JSON.stringify(tree.toJSON())).toContain("Jane Lifter");
    expect(tree.root.findAllByProps({ testID: "session-athletes-empty" })).toHaveLength(0);
    act(() => tree.unmount());
  });
});
