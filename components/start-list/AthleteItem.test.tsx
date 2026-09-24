import React, { useEffect, useState } from "react";
import { act, create, type ReactTestInstance } from "react-test-renderer";

import type { LiftResult } from "@/data/types/athletes";
import { getChevronIcon } from "@/lib/start-list-utils";
import { ExpandedIdProvider } from "@/contexts/ExpandedIdContext";
import { getLastYearBests } from "@/lib/start-list-api";
import { ActivityIndicator } from "react-native";
import { AthleteItem, type AthleteRowProps } from "./AthleteItem";

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: { View: jest.requireActual("react-native").View },
  FadeIn: { duration: () => ({}) },
}));
jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("@/lib/start-list-api", () => ({
  getLastYearBests: jest.fn(async () => ({
    bestSnatch: 0,
    bestCJ: 0,
    bestTotal: 0,
  })),
}));
jest.mock("@/lib/start-list-utils", () => {
  const actual = jest.requireActual("@/lib/start-list-utils");
  // Called exactly once per render of the collapsed row, so its call count is
  // the row's render count.
  return { ...actual, getChevronIcon: jest.fn(actual.getChevronIcon) };
});
// Regression guard for H3: the row must not read these itself. A row that
// imports any of them would call the throwing hook on mount. (Each factory
// builds its own thrower: `jest.mock` is hoisted above module scope.)
jest.mock("@/utils/authGuard", () => ({
  useAuthGuard: () => {
    throw new Error("AthleteItem must not read app contexts");
  },
}));
jest.mock("@/contexts/SelectedMeetContext", () => ({
  useSelectedMeet: () => {
    throw new Error("AthleteItem must not read app contexts");
  },
}));
jest.mock("@/contexts/SubscriptionContext", () => ({
  useSubscription: () => {
    throw new Error("AthleteItem must not read app contexts");
  },
}));
jest.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => {
    throw new Error("AthleteItem must not read app contexts");
  },
}));

const ATHLETE: LiftResult = {
  memberId: "123",
  name: "Jane Doe",
  age: 24,
  club: "Barbell Club",
  gender: "F",
  weightClass: "59",
  entryTotal: 180,
  adaptive: false,
  session: {
    number: 4,
    platform: "Red",
    date: "2026-06-20",
    startTime: "9:00 AM",
    weighInTime: "7:00 AM",
    displayDate: "Saturday",
  },
};

function makeProps(overrides: Partial<AthleteRowProps> = {}): AthleteRowProps {
  return {
    athlete: ATHLETE,
    router: { push: jest.fn() } as unknown as AthleteRowProps["router"],
    getSessionDetails: () => null,
    onExpand: undefined,
    index: 0,
    currentTheme: "light",
    validMeet: "Test Meet",
    timeZoneAbbr: "MDT",
    timeZoneIdentifier: "America/Denver",
    isSubscribed: false,
    onSeeAllResults: jest.fn(),
    ...overrides,
  };
}

let rerenderParent: () => void = () => {};

/**
 * The composite `Pressable` instances in the tree. `findAllByType(Pressable)`
 * does not match under jest-expo because the export is a memo/forwardRef
 * wrapper, so match on the prop the row hands it instead.
 */
function findPressables(tree: ReturnType<typeof create>): ReactTestInstance[] {
  return tree.root.findAll(
    (node) =>
      typeof node.type !== "string" &&
      typeof node.props.onPress === "function" &&
      // `Pressable` forwards `onPress` down to no composite child, so the
      // first composite holder of each handler is the `Pressable` itself.
      !(node.parent && node.parent.props.onPress === node.props.onPress),
  );
}

/** A stand-in for the screen: re-renders for reasons unrelated to the row. */
function Parent({ props }: { props: AthleteRowProps }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    rerenderParent = () => setTick((t) => t + 1);
  }, []);
  return (
    <ExpandedIdProvider>
      <AthleteItem {...props} />
    </ExpandedIdProvider>
  );
}

beforeAll(() => {
  const g = globalThis as unknown as {
    requestIdleCallback?: (cb: () => void) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  g.requestIdleCallback ??= (cb) => setTimeout(cb, 0) as unknown as number;
  g.cancelIdleCallback ??= (handle) => clearTimeout(handle);
});

beforeEach(() => {
  jest.mocked(getChevronIcon).mockClear();
  jest.mocked(getLastYearBests).mockClear();
});

describe("AthleteItem", () => {
  it("does not re-render when the screen re-renders with the same props", () => {
    const props = makeProps();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Parent props={props} />);
    });
    expect(getChevronIcon).toHaveBeenCalledTimes(1);

    act(() => {
      rerenderParent();
    });
    act(() => {
      rerenderParent();
    });
    expect(getChevronIcon).toHaveBeenCalledTimes(1);

    act(() => {
      tree.unmount();
    });
  });

  it("formats the session time with the abbreviation it was given", async () => {
    const props = makeProps({ timeZoneAbbr: "EST" });
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Parent props={props} />);
    });
    const [nameRow] = findPressables(tree);
    await act(async () => {
      nameRow.props.onPress();
    });

    expect(JSON.stringify(tree.toJSON())).toContain("9:00 AM EST");

    act(() => {
      tree.unmount();
    });
  });

  it("hands the results press to the screen's gate with the athlete name", async () => {
    const props = makeProps();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Parent props={props} />);
    });
    const [nameRow] = findPressables(tree);
    await act(async () => {
      nameRow.props.onPress();
    });

    const pressables = findPressables(tree);
    const resultsButton = pressables[pressables.length - 1];
    act(() => {
      resultsButton.props.onPress();
    });

    expect(props.onSeeAllResults).toHaveBeenCalledTimes(1);
    expect(props.onSeeAllResults).toHaveBeenCalledWith("Jane Doe");
    expect(props.router.push).not.toHaveBeenCalled();

    act(() => {
      tree.unmount();
    });
  });
});

function mountRow(props: AthleteRowProps) {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<Parent props={props} />);
  });
  return tree;
}

async function toggleRow(tree: ReturnType<typeof create>) {
  const [nameRow] = findPressables(tree);
  await act(async () => {
    nameRow.props.onPress();
  });
}

/** Lets the idle callback (a 0 ms timer here) and the bests promise run. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

const spinnerCount = (tree: ReturnType<typeof create>) =>
  tree.root.findAll((node) => node.type === ActivityIndicator).length;

describe("AthleteItem session link", () => {
  it("opens the session with the embedded meet-local fields and the meet", async () => {
    const props = makeProps();
    const tree = mountRow(props);
    await toggleRow(tree);

    const [, sessionLink] = findPressables(tree);
    act(() => sessionLink.props.onPress());

    expect(props.router.push).toHaveBeenCalledWith({
      pathname: "/shared-screens/schedule-details",
      params: {
        id: "session-4-Red",
        sessionNumber: 4,
        platform: "Red",
        weightClass: "59",
        startTime: "9:00 AM",
        weighInTime: "7:00 AM",
        date: "2026-06-20",
        athleteName: "Jane Doe",
        meet: "Test Meet",
      },
    });
    act(() => tree.unmount());
  });

  it("falls back to the schedule's platform start time and derives the weigh-in", async () => {
    const props = makeProps({
      athlete: {
        ...ATHLETE,
        session: { number: 4, platform: "Blue" },
      },
      getSessionDetails: () =>
        ({
          date: "2026-06-21",
          displayDate: "Sunday",
          startTime: "8:00 AM",
          weighInTime: "6:00 AM",
          platforms: [
            { platform: "Red", platformStartTime: "8:00 AM" },
            { platform: "Blue", platformStartTime: "1:00 PM" },
          ],
        }) as unknown as ReturnType<AthleteRowProps["getSessionDetails"]>,
    });
    const tree = mountRow(props);
    await toggleRow(tree);
    const [, sessionLink] = findPressables(tree);
    act(() => sessionLink.props.onPress());

    expect(props.router.push).toHaveBeenCalledTimes(1);
    expect(jest.mocked(props.router.push).mock.calls[0][0]).toMatchObject({
      params: { startTime: "1:00 PM", weighInTime: "11:00 AM", date: "2026-06-21" },
    });
    act(() => tree.unmount());
  });

  it("does not navigate to a session it cannot place in time", async () => {
    const props = makeProps({
      athlete: { ...ATHLETE, session: { number: 4, platform: "Blue" } },
      getSessionDetails: () => null,
    });
    const tree = mountRow(props);
    await toggleRow(tree);
    const [, sessionLink] = findPressables(tree);
    act(() => sessionLink.props.onPress());

    expect(props.router.push).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});

describe("AthleteItem year bests", () => {
  it("stops the spinner and shows dashes when the bests request fails", async () => {
    // Rejected by the test once the request is in flight, not up front: the
    // request starts from an idle callback (a 0ms timer here), and an
    // already-rejected mock could settle inside the toggle's act() before the
    // spinner was observed, so the test failed intermittently on CI.
    let rejectBests!: (error: Error) => void;
    jest
      .mocked(getLastYearBests)
      .mockImplementationOnce(() => new Promise((_, reject) => (rejectBests = reject)));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const tree = mountRow(makeProps({ isSubscribed: true }));
    await toggleRow(tree);
    await settle(); // the idle callback runs; the request is now pending
    expect(getLastYearBests).toHaveBeenCalledTimes(1);
    expect(spinnerCount(tree)).toBe(1);

    await act(async () => {
      rejectBests(new Error("timeout"));
    });
    await settle();

    expect(getLastYearBests).toHaveBeenCalledWith("Jane Doe");
    expect(spinnerCount(tree)).toBe(0);
    expect(JSON.stringify(tree.toJSON())).toContain("—");
    warn.mockRestore();
    act(() => tree.unmount());
  });

  it("never shows a stale answer from a request started before the row was collapsed", async () => {
    let resolveFirst!: (value: { bestSnatch: number; bestCJ: number; bestTotal: number }) => void;
    jest
      .mocked(getLastYearBests)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(() => new Promise(() => {}));
    const tree = mountRow(makeProps({ isSubscribed: true }));

    await toggleRow(tree); // open: first request in flight
    await settle();
    await toggleRow(tree); // close
    await toggleRow(tree); // open again: second request in flight
    await settle();
    expect(getLastYearBests).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveFirst({ bestSnatch: 80, bestCJ: 100, bestTotal: 180 });
    });

    // The first answer belongs to a closed effect; the row keeps waiting for
    // its own request instead of painting it.
    expect(spinnerCount(tree)).toBe(1);
    expect(JSON.stringify(tree.toJSON())).not.toContain("180kg");
    act(() => tree.unmount());
  });

  it("does not request bests for a collapsed row", async () => {
    const tree = mountRow(makeProps({ isSubscribed: true }));
    await settle();
    expect(getLastYearBests).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
