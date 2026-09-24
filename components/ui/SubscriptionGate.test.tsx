/**
 * `SubscriptionGate` with the real `SubscriptionProvider`. Only RevenueCat,
 * OneSignal, SecureStore and the network probe are stubbed. A background
 * refresh of a known entitlement must not unmount the gated screen.
 */
import React, { useEffect } from "react";
import { ActivityIndicator, Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import * as SecureStore from "expo-secure-store";
import Purchases, { type CustomerInfo } from "react-native-purchases";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import { SubscriptionGate } from "@/components/ui/SubscriptionGate";

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

jest.mock("expo-router", () => ({ usePathname: () => "/(tabs)/records" }));
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));

jest.mock("@/app/shared-screens/paywall", () => {
  const { Text: MockText } = jest.requireActual<typeof import("react-native")>("react-native");
  return { __esModule: true, default: () => <MockText>Paywall</MockText> };
});

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

describe("SubscriptionGate", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    mounts = 0;
    unmounts = 0;
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
