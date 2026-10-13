/**
 * The real paywall screen with RevenueCat, Clerk and the router stubbed.
 * It must show an error with Try Again instead of spinning forever, use
 * RevenueCat's current offering, leave navigation alone inline after a
 * purchase, and say so when a restore finds nothing.
 */
import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import PaywallScreen from "@/app/shared-screens/paywall";
import { showToast } from "@/lib/toast";
import { isPremiumFeature } from "@/lib/premium-intent";

jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));
jest.mock("@/hooks/useScreenInsets", () => ({
  useScreenHorizontalInsets: () => ({ paddingLeft: 0, paddingRight: 0 }),
}));
jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: { View: jest.requireActual("react-native").View },
  useSharedValue: (value: number) => ({ value }),
  useAnimatedStyle: () => ({}),
  withSpring: () => 1,
}));
// `__DEV__` is true under Jest and the dev config may simulate a subscription.
jest.mock("@/config/development", () => ({
  getSimulatedSubscriptionStatus: () => null,
}));
jest.mock("@/lib/toast", () => ({ showToast: jest.fn() }));
const mockShowToast = showToast as jest.MockedFunction<typeof showToast>;

const mockRecheck = jest.fn();
jest.mock("@/contexts/SubscriptionContext", () => ({
  useSubscription: () => ({ recheckSubscription: mockRecheck }),
}));

let mockIsOffline = false;
jest.mock("@/hooks/useIsOffline", () => ({
  useIsOffline: () => [mockIsOffline, () => {}],
}));

let mockUser: { user: { id: string } | null; isLoaded: boolean } = {
  user: { id: "user_1" },
  isLoaded: true,
};
jest.mock("@clerk/expo", () => ({ useUser: () => mockUser }));

const mockRouter = {
  dismissTo: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};
let mockParams: { from?: string; feature?: string } = {};
let mockScreenOptions: Record<string, unknown>[] = [];
jest.mock("expo-router", () => ({
  Stack: {
    Screen: ({ options }: { options: Record<string, unknown> }) => {
      mockScreenOptions.push(options);
      return null;
    },
  },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

const mockGetOfferings = jest.fn();
jest.mock("react-native-purchases", () => ({
  __esModule: true,
  default: { getOfferings: () => mockGetOfferings() },
}));

type PaywallProps = {
  options: { offering: unknown };
  onPurchaseCompleted: (event: { customerInfo: unknown }) => void;
  onRestoreCompleted: (event: { customerInfo: unknown }) => void;
  onDismiss: () => void;
};
const mockPaywallProps: PaywallProps[] = [];
jest.mock("react-native-purchases-ui", () => ({
  __esModule: true,
  default: {
    Paywall: (props: PaywallProps) => {
      mockPaywallProps.push(props);
      return null;
    },
  },
}));

const CURRENT = { identifier: "default" };
const EXPERIMENT = { identifier: "new image test" };

function customerInfo(subscribed: boolean) {
  return {
    entitlements: {
      active: subscribed ? { Subscriptions: { productIdentifier: "meetcal_quarterly" } } : {},
    },
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

async function mount(element: React.ReactElement = <PaywallScreen />): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element);
  });
  await flush();
  return renderer;
}

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => String(node.props.children));
}

async function pressTryAgain(renderer: ReactTestRenderer): Promise<void> {
  const target = renderer.root.findAll(
    (node) =>
      typeof node.props.onPress === "function" &&
      node.findAllByType(Text).some((text) => text.props.children === "Try Again"),
  )[0];
  await act(async () => {
    target.props.onPress();
  });
  await flush();
}

function lastPaywall(): PaywallProps {
  const props = mockPaywallProps.at(-1);
  if (!props) throw new Error("Paywall not rendered");
  return props;
}

describe("PaywallScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    mockPaywallProps.length = 0;
    mockScreenOptions = [];
    mockIsOffline = false;
    mockUser = { user: { id: "user_1" }, isLoaded: true };
    mockParams = { from: "/shared-screens/schedule-details", feature: "qualifying-totals" };
    mockRouter.canGoBack.mockReturnValue(true);
    mockGetOfferings.mockResolvedValue({
      current: CURRENT,
      all: { default: CURRENT, "new image test": EXPERIMENT },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses RevenueCat's current offering, not a hard-coded experiment", async () => {
    await mount();
    expect(lastPaywall().options.offering).toBe(CURRENT);
  });

  it("shows an error with Try Again when offerings fail, and recovers on retry", async () => {
    mockGetOfferings.mockRejectedValueOnce(new Error("rc down"));
    const renderer = await mount();

    expect(mockPaywallProps).toEqual([]);
    expect(texts(renderer)).toContain("Couldn't load plans");

    await pressTryAgain(renderer);

    expect(mockGetOfferings).toHaveBeenCalledTimes(2);
    expect(lastPaywall().options.offering).toBe(CURRENT);
  });

  it.each([
    ["routed", <PaywallScreen key="routed" />],
    ["inline", <PaywallScreen
      key="inline" from="/comp-data/records" feature="records"
      inline
    />],
  ])("%s: loading and failing, shows a header with Back; ready, hides it", async (_mode, element) => {
    let rejectOfferings!: (error: Error) => void;
    mockGetOfferings.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectOfferings = reject;
      }),
    );
    const renderer = await mount(element);

    // Spinner: the root Stack hides headers by default, so the paywall must
    // turn one on, as `title` (a `headerTitle` outranked the gated screen's
    // own title after a purchase).
    expect(mockScreenOptions.at(-1)).toMatchObject({
      headerShown: true,
      title: "Premium Features",
      headerBackTitle: "Back",
    });
    expect(
      mockScreenOptions.every((options) => options.headerTitle === undefined),
    ).toBe(true);

    await act(async () => {
      rejectOfferings(new Error("rc down"));
    });
    await flush();
    expect(texts(renderer)).toContain("Couldn't load plans");
    expect(mockScreenOptions.at(-1)).toMatchObject({ headerShown: true });

    await pressTryAgain(renderer);
    expect(lastPaywall().options.offering).toBe(CURRENT);
    expect(mockScreenOptions.at(-1)).toEqual({ headerShown: false });
  });

  it("replaces the title a premium screen set before its entitlement lapsed", async () => {
    mockGetOfferings.mockRejectedValue(new Error("rc down"));
    const renderer = await mount(
      <PaywallScreen from="/shared-screens/athlete-results" feature="athlete-results" inline />,
    );
    expect(texts(renderer)).toContain("Couldn't load plans");

    // `setOptions` merges into what the subscribed screen already set and
    // never resets it, and `headerTitle` outranks `title`.
    const merged: Record<string, unknown> = Object.assign(
      { headerShown: true, headerTitle: "Jane Doe" },
      ...mockScreenOptions,
    );
    expect(merged.headerTitle).toBeUndefined();
    expect(merged.title).toBe("Premium Features");
  });

  it("inline and signed out, signs in back to the gated screen without queueing a second paywall", async () => {
    mockUser = { user: null, isLoaded: true };
    await mount(
      <PaywallScreen
        from="/shared-screens/athlete-results?name=Jane%20Doe"
        feature="athlete-results"
        inline
      />,
    );

    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: "/(auth)/sign-in",
      // `%` escaped: `useLocalSearchParams` decodes the param a second time.
      params: { from: "/shared-screens/athlete-results?name=Jane%2520Doe", feature: "subscription" },
    });
    expect(isPremiumFeature("subscription")).toBe(false);
  });

  it("says when there is no current offering", async () => {
    mockGetOfferings.mockResolvedValue({ current: null, all: {} });
    const renderer = await mount();
    expect(texts(renderer)).toContain("No plans available");
  });

  it("offline, says so instead of spinning while Clerk cannot load", async () => {
    mockIsOffline = true;
    mockUser = { user: null, isLoaded: false };
    const renderer = await mount();

    expect(texts(renderer)).toContain("You're offline");
    expect(mockGetOfferings).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();

    // Try Again cannot load anything until Clerk can; it says so.
    await pressTryAgain(renderer);
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/Connect to the internet/) }),
    );
  });

  it("routed: returns to the origin after a purchase", async () => {
    await mount();
    act(() => lastPaywall().onPurchaseCompleted({ customerInfo: customerInfo(true) }));
    expect(mockRouter.dismissTo).toHaveBeenCalledWith("/shared-screens/schedule-details");
  });

  it("inline: leaves navigation alone after a purchase so the gate re-renders", async () => {
    await mount(<PaywallScreen from="/(tabs)/records" feature="records" inline />);
    act(() => lastPaywall().onPurchaseCompleted({ customerInfo: customerInfo(true) }));
    expect(mockRouter.dismissTo).not.toHaveBeenCalled();
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    // In case the listener never fires (the gate's "denied" came from cache).
    expect(mockRecheck).toHaveBeenCalledTimes(1);
  });

  it("inline: closing leaves the gated screen", async () => {
    await mount(<PaywallScreen from="/(tabs)/records" feature="records" inline />);
    act(() => lastPaywall().onDismiss());
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(mockRouter.dismissTo).not.toHaveBeenCalled();
  });

  it("says so and stays when a restore finds no subscription", async () => {
    await mount();
    act(() => lastPaywall().onRestoreCompleted({ customerInfo: customerInfo(false) }));
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/No active subscription/) }),
    );
    expect(mockRouter.dismissTo).not.toHaveBeenCalled();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });
});
