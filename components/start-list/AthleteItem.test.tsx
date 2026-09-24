import React, { useEffect, useState } from "react";
import { act, create, type ReactTestInstance } from "react-test-renderer";

import type { LiftResult } from "@/data/types/athletes";
import { getChevronIcon } from "@/lib/start-list-utils";
import { ExpandedIdProvider } from "@/contexts/ExpandedIdContext";
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
