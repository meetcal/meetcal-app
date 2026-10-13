// Lives outside app/: Expo Router turns every file under app/ into a route.
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import WidgetSettingsScreen from "@/app/schedule-toolbar/widget-settings";
import { showToast } from "@/components/ui/Toast";
import {
  defaultWidgetSettings,
  saveWidgetSettings,
  syncDataWidgets,
  type WidgetSettings,
} from "@/utils/dataWidgets";

type ResourceState = {
  data: unknown;
  isInitialLoading: boolean;
  error: string | null;
};

const mockLoaded: Record<string, ResourceState> = {
  totals: {
    data: { Nationals: { Senior: { Men: { "89": 300 } } } },
    isInitialLoading: false,
    error: null,
  },
  standards: {
    data: {
      u15: { men: [], women: [] },
      youth: { men: [], women: [] },
      junior: { men: [], women: [] },
      senior: { men: [{ weightClass: "89", a: 330, b: 310 }], women: [] },
    },
    isInitialLoading: false,
    error: null,
  },
  rankings: {
    data: [
      {
        meet: "Worlds",
        ranking: 1,
        name: "A Lifter",
        weightClass: "89",
        total: 350,
        percentA: 101,
        gender: "Men",
        ageCategory: "Senior",
      },
    ],
    isInitialLoading: false,
    error: null,
  },
};

let mockResources: Record<string, ResourceState> = mockLoaded;
let mockGateProps: { from?: string; feature?: string } | null = null;
let mockModals: { onApplyFilters: (filters: Record<string, string>) => void }[] = [];

const storedSettings: WidgetSettings = {
  ...defaultWidgetSettings,
  intlRankings: { meet: "Worlds", ageCategory: "Senior", gender: "Men" },
};

jest.mock("@/components/ui/SubscriptionGate", () => ({
  SubscriptionGate: ({
    children,
    from,
    feature,
  }: {
    children: React.ReactNode;
    from?: string;
    feature?: string;
  }) => {
    mockGateProps = { from, feature };
    return children;
  },
}));
jest.mock("@/hooks/useMutableResource", () => ({
  useMutableResource: ({ resource }: { resource: { id: string } }) =>
    mockResources[resource.id],
}));
jest.mock("@/lib/database/fetch-qualifying-totals", () => ({
  qualifyingTotalsResource: { id: "totals" },
}));
jest.mock("@/lib/database/fetch-standards", () => ({
  standardsResource: { id: "standards" },
}));
jest.mock("@/lib/database/fetchIntlRankings", () => ({
  intlRankingsResource: { id: "rankings" },
}));
jest.mock("@/utils/dataWidgets", () => ({
  ...jest.requireActual("@/utils/dataWidgets"),
  loadWidgetSettings: jest.fn(),
  saveWidgetSettings: jest.fn(async () => {}),
  syncDataWidgets: jest.fn(),
}));
jest.mock("@/components/ui/Toast", () => ({ showToast: jest.fn() }));
jest.mock("@/components/ui/filters", () => ({
  GenericFilterModal: (props: {
    onApplyFilters: (filters: Record<string, string>) => void;
  }) => {
    mockModals.push(props);
    return null;
  },
}));
jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ currentTheme: "light" }),
}));
jest.mock("@/hooks/useScreenInsets", () => ({
  useScreenHorizontalInsets: () => ({}),
}));
jest.mock("expo-router", () => ({ Stack: { Screen: () => null } }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

async function render(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<WidgetSettingsScreen />);
  });
  return tree;
}

function updateButton(tree: ReactTestRenderer) {
  // The filter rows are pressable too; only the update button sets `disabled`.
  const [button] = tree.root.findAll(
    (node) => typeof node.props.onPress === "function" && typeof node.props.disabled === "boolean",
  );
  return button;
}

/** The qualifying-totals filter modal's apply, as the user would tap it. */
async function applyQualifyingTotals(filters: Record<string, string>) {
  await act(async () => {
    mockModals[mockModals.length - 3].onApplyFilters(filters);
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockResources = mockLoaded;
  mockGateProps = null;
  mockModals = [];
  const { loadWidgetSettings } = jest.requireMock("@/utils/dataWidgets");
  loadWidgetSettings.mockResolvedValue(storedSettings);
});

it("is behind the subscription gate, returning here after the paywall", async () => {
  const tree = await render();
  expect(mockGateProps).toEqual({
    from: "/schedule-toolbar/widget-settings",
    feature: "widget-settings",
  });
  act(() => tree.unmount());
});

it("writes the widgets when the data loaded", async () => {
  const tree = await render();
  // The background commit writes the stored filters once.
  expect(syncDataWidgets).toHaveBeenCalledTimes(1);

  await applyQualifyingTotals({ event: "Nationals", gender: "Men", ageGroup: "Senior" });
  expect(updateButton(tree).props.disabled).toBe(false);
  act(() => tree.unmount());
});

describe("when the widget data failed to load", () => {
  beforeEach(() => {
    // `useMutableResource` sets `error` only with nothing cached, leaving the
    // data at its empty initial value.
    mockResources = {
      ...mockLoaded,
      totals: { data: {}, isInitialLoading: false, error: "Couldn't load qualifying totals" },
    };
  });

  it("disables Update Widgets", async () => {
    const tree = await render();
    expect(updateButton(tree).props.disabled).toBe(true);
    act(() => tree.unmount());
  });

  it("saves applied filters without blanking the widgets, and says why", async () => {
    const tree = await render();
    await applyQualifyingTotals({ event: "Nationals", gender: "Women", ageGroup: "Junior" });

    expect(saveWidgetSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        qualifyingTotals: { event: "Nationals", gender: "Women", ageGroup: "Junior" },
      }),
    );
    expect(syncDataWidgets).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "info", message: expect.stringMatching(/once the widget data loads/) }),
    );
    expect(showToast).not.toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
    act(() => tree.unmount());
  });
});

it("does not write widgets from data that is still loading", async () => {
  mockResources = {
    ...mockLoaded,
    rankings: { data: [], isInitialLoading: true, error: null },
  };
  const tree = await render();
  await applyQualifyingTotals({ event: "Nationals", gender: "Women", ageGroup: "Senior" });

  expect(saveWidgetSettings).toHaveBeenCalled();
  expect(syncDataWidgets).not.toHaveBeenCalled();
  expect(updateButton(tree).props.disabled).toBe(true);
  act(() => tree.unmount());
});
