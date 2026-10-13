/**
 * `SubscriptionGate` with the real `SubscriptionProvider`. Only RevenueCat,
 * OneSignal, SecureStore and the network probe are stubbed. A background
 * refresh of a known entitlement must not unmount the gated screen, and an
 * unknown entitlement must never show the paywall.
 */
import React, { useEffect } from "react";
import { ActivityIndicator, Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import * as SecureStore from "expo-secure-store";
import Purchases, { type CustomerInfo } from "react-native-purchases";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import {
  featureNameFromPathname,
  gateOrigin,
  SubscriptionGate,
} from "@/components/ui/SubscriptionGate";
import { originRouteParam } from "@/utils/returnToOrigin";

const mockSecureStore = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStore.set(key, value);
  }),
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStore.delete(key);
  }),
}));

jest.mock("react-native-purchases", () => ({
  __esModule: true,
  default: {
    getCustomerInfo: jest.fn(),
    addCustomerInfoUpdateListener: jest.fn(),
    removeCustomerInfoUpdateListener: jest.fn(),
    getAppUserID: jest.fn(async () => "rc_user"),
    restorePurchases: jest.fn(),
  },
}));

jest.mock("react-native-onesignal", () => ({
  OneSignal: {
    User: {
      getExternalId: jest.fn(async () => "rc_user"),
      addTags: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    },
  },
}));

jest.mock("@/config/development", () => ({
  getSimulatedSubscriptionStatus: () => null,
}));

jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(async () => true),
  subscribeToNetworkChanges: () => () => {},
}));
jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: { View: jest.requireActual("react-native").View },
  useSharedValue: (value: number) => ({ value }),
  useAnimatedStyle: () => ({}),
  withSpring: () => 1,
}));

let mockScreenOptions: Record<string, unknown> | null = null;
jest.mock("expo-router", () => ({
  usePathname: () => "/(tabs)/records",
  useLocalSearchParams: () => ({}),
  Stack: {
    Screen: ({ options }: { options: Record<string, unknown> }) => {
      mockScreenOptions = options;
      return null;
    },
  },
}));
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));

jest.mock("@/app/shared-screens/paywall", () => {
  const { Text: MockText } = jest.requireActual<typeof import("react-native")>("react-native");
  return { __esModule: true, default: () => <MockText>Paywall</MockText> };
});

const mockIsNetworkAvailable = jest.requireMock("@/lib/networkUtils")
  .isNetworkAvailable as jest.Mock;
const mockGetCustomerInfo = Purchases.getCustomerInfo as jest.MockedFunction<
  typeof Purchases.getCustomerInfo
>;
const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock;
const mockAddListener = Purchases.addCustomerInfoUpdateListener as jest.Mock;

const SECURE_KEY = "subscription_cache_v3";
const REFRESH_DELAY_MS = 8000;

function customerInfo(productIdentifier: string | null): CustomerInfo {
  return {
    entitlements: {
      active: productIdentifier ? { Subscriptions: { productIdentifier } } : {},
    },
  } as never;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

let mounts = 0;
let unmounts = 0;
function GatedScreen() {
  useEffect(() => {
    mounts += 1;
    return () => {
      unmounts += 1;
    };
  }, []);
  return <Text>Gated</Text>;
}

async function mountGate(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <SubscriptionProvider>
        <SubscriptionGate>
          <GatedScreen />
        </SubscriptionGate>
      </SubscriptionProvider>,
    );
  });
  await flush();
  return renderer;
}

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => String(node.props.children));
}

async function press(renderer: ReactTestRenderer, label: string): Promise<void> {
  const target = renderer.root.findAll(
    (node) =>
      typeof node.props.onPress === "function" &&
      node.findAllByType(Text).some((text) => text.props.children === label),
  )[0];
  if (!target) throw new Error(`No pressable labelled ${label}`);
  await act(async () => {
    target.props.onPress();
  });
  await flush();
}

describe("SubscriptionGate", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    mounts = 0;
    unmounts = 0;
    mockScreenOptions = null;
    mockSecureStore.clear();
    mockSecureStore.set(
      SECURE_KEY,
      JSON.stringify({
        appUserId: "rc_user",
        isSubscribed: true,
        subscriptionType: "quarterly",
        timestamp: Date.now(),
      }),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("shows a spinner, not the paywall, until the first entitlement answer, then the screen", async () => {
    let finishRead!: () => void;
    (SecureStore.getItemAsync as jest.Mock).mockImplementationOnce(
      (key: string) =>
        new Promise<string | null>((resolve) => {
          finishRead = () => resolve(mockSecureStore.get(key) ?? null);
        }),
    );

    const renderer = await mountGate();
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
    expect(texts(renderer)).toEqual([]);
    expect(mounts).toBe(0);
    // The screen's own header is not rendered yet: the spinner brings one,
    // so there is a Back button.
    expect(mockScreenOptions).toMatchObject({ headerShown: true, title: "" });
    // Cleared, not set: a `headerTitle` would outrank the screen's own title.
    expect(mockScreenOptions).toHaveProperty("headerTitle", undefined);

    await act(async () => {
      finishRead();
    });
    await flush();

    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    expect(texts(renderer)).toEqual(["Gated"]);
    expect(mounts).toBe(1);
  });

  it("keeps the gated screen mounted across the post-launch refresh", async () => {
    let resolveInfo!: (info: CustomerInfo) => void;
    mockGetCustomerInfo.mockReturnValue(
      new Promise<CustomerInfo>((resolve) => {
        resolveInfo = resolve;
      }),
    );

    const renderer = await mountGate();
    expect(texts(renderer)).toEqual(["Gated"]);
    expect(mounts).toBe(1);

    // The 8s refresh starts and RevenueCat has not answered yet.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(REFRESH_DELAY_MS);
    });
    await flush();
    expect(mockGetCustomerInfo).toHaveBeenCalledTimes(1);
    expect(texts(renderer)).toEqual(["Gated"]);

    await act(async () => {
      resolveInfo(customerInfo("meetcal_quarterly"));
    });
    await flush();

    expect(texts(renderer)).toEqual(["Gated"]);
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
  });

  it("keeps the gated screen mounted across a CustomerInfo listener update", async () => {
    const renderer = await mountGate();
    const listener = mockAddListener.mock.calls[0][0] as (info: CustomerInfo) => Promise<void>;

    // Hold the listener mid-update (its SecureStore write pending), which is
    // where the provider reports `isLoading`.
    let finishWrite!: () => void;
    mockSetItemAsync.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        finishWrite = resolve;
      }),
    );
    let update!: Promise<void>;
    await act(async () => {
      update = listener(customerInfo("meetcal_lifetime"));
    });
    await flush();
    expect(texts(renderer)).toEqual(["Gated"]);

    await act(async () => {
      finishWrite();
      await update;
    });
    await flush();

    expect(texts(renderer)).toEqual(["Gated"]);
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
  });

  describe("with no cached entitlement", () => {
    beforeEach(() => {
      mockSecureStore.clear();
    });

    it("checks RevenueCat at once and shows a spinner, never the paywall, until it answers", async () => {
      let resolveInfo!: (info: CustomerInfo) => void;
      mockGetCustomerInfo.mockReturnValue(
        new Promise<CustomerInfo>((resolve) => {
          resolveInfo = resolve;
        }),
      );

      const renderer = await mountGate();
      // No 8 s wait: with nothing cached there is nothing to paint first.
      expect(mockGetCustomerInfo).toHaveBeenCalledTimes(1);
      expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
      expect(texts(renderer)).not.toContain("Paywall");

      await act(async () => {
        resolveInfo(customerInfo("meetcal_quarterly"));
      });
      await flush();

      expect(texts(renderer)).toEqual(["Gated"]);
    });

    it("offline, says it can't confirm the subscription and retries on Try Again", async () => {
      mockIsNetworkAvailable.mockResolvedValue(false);

      const renderer = await mountGate();

      expect(mockGetCustomerInfo).not.toHaveBeenCalled();
      expect(texts(renderer)).toContain("Can't confirm your subscription");
      expect(texts(renderer)).not.toContain("Paywall");
      expect(mounts).toBe(0);
      expect(mockScreenOptions).toMatchObject({ headerShown: true, headerBackTitle: "Back" });

      mockIsNetworkAvailable.mockResolvedValue(true);
      mockGetCustomerInfo.mockResolvedValue(customerInfo("meetcal_lifetime"));
      await press(renderer, "Try Again");

      expect(mockGetCustomerInfo).toHaveBeenCalledTimes(1);
      expect(texts(renderer)).toEqual(["Gated"]);
    });

    it("shows the paywall once RevenueCat says the user is free", async () => {
      mockGetCustomerInfo.mockResolvedValue(customerInfo(null));

      const renderer = await mountGate();

      expect(texts(renderer)).toEqual(["Paywall"]);
    });
  });

  it("shows the paywall when a listener update ends the entitlement", async () => {
    const renderer = await mountGate();
    const listener = mockAddListener.mock.calls[0][0] as (info: CustomerInfo) => Promise<void>;

    await act(async () => {
      await listener(customerInfo(null));
    });
    await flush();

    expect(texts(renderer)).toEqual(["Paywall"]);
  });
});

describe("gateOrigin", () => {
  it("keeps the gated route's params, so sign-in comes back to the same athlete", () => {
    expect(gateOrigin("/shared-screens/athlete-results", { name: "José Núñez" })).toBe(
      "/shared-screens/athlete-results?name=Jos%C3%A9%20N%C3%BA%C3%B1ez",
    );
    expect(
      gateOrigin("/shared-screens/attempt-estimator", {
        meet: "A & B",
        sessionNumber: "1",
        platform: "Red",
      }),
    ).toBe("/shared-screens/attempt-estimator?meet=A%20%26%20B&sessionNumber=1&platform=Red");
  });

  it("is the bare path without params, and skips values that are not strings", () => {
    expect(gateOrigin("/comp-data/records", {})).toBe("/comp-data/records");
    expect(
      gateOrigin("/comp-data/records", { a: undefined, b: ["x", "y"], c: { nested: 1 } as never }),
    ).toBe("/comp-data/records?b=x&b=y");
  });

  it("names the feature from the path, not the query", () => {
    expect(featureNameFromPathname("/shared-screens/athlete-results?name=X")).toBe(
      "athlete-results",
    );
  });
});

/** A query string's params, decoded once, as expo-router's href parser does. */
function parseQuery(href: string): Record<string, string> {
  const query = href.split("?")[1] ?? "";
  return Object.fromEntries(
    query
      .split("&")
      .filter(Boolean)
      .map((pair) => pair.split("=").map((part) => decodeURIComponent(part))),
  );
}

describe("gateOrigin through sign-in", () => {
  it.each(["A & B", "C+D", "100% Club", "Club #1", "Zoë Smith"])(
    "brings a gated route's params back from sign-in intact: %s",
    (meet) => {
      const from = gateOrigin("/shared-screens/attempt-estimator", {
        meet,
        sessionNumber: "1",
      });
      // The paywall navigates to sign-in with `params: { from }`: expo-router
      // encodes the value into the href, parses it back (one decode), and
      // `useLocalSearchParams` decodes it again.
      const href = `/(auth)/sign-in?from=${encodeURIComponent(originRouteParam(from))}`;
      const received = decodeURIComponent(parseQuery(href).from);

      expect(received).toBe(from);
      expect(parseQuery(received)).toEqual({ meet, sessionNumber: "1" });
    },
  );
});
