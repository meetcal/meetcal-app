import React from "react";
import { act, create } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Purchases from "react-native-purchases";
import { isNetworkAvailable } from "@/lib/networkUtils";
import {
  SubscriptionProvider,
  useSubscription,
} from "@/contexts/SubscriptionContext";

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

// `__DEV__` is true under Jest and `DEV_CONFIG.SIMULATE_SUBSCRIPTION` is on,
// which would short-circuit every path this file is about.
jest.mock("@/config/development", () => ({
  getSimulatedSubscriptionStatus: () => null,
}));

let mockNetworkListener: ((isConnected: boolean) => void) | null = null;
jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(async () => true),
  subscribeToNetworkChanges: (callback: (isConnected: boolean) => void) => {
    mockNetworkListener = callback;
    return () => {
      mockNetworkListener = null;
    };
  },
}));

const mockGetCustomerInfo = Purchases.getCustomerInfo as jest.MockedFunction<
  typeof Purchases.getCustomerInfo
>;
const mockIsNetworkAvailable = isNetworkAvailable as jest.MockedFunction<
  typeof isNetworkAvailable
>;

const SECURE_KEY = "subscription_cache_v3";
const LEGACY_KEY = "subscription_cache_v2";
const REFRESH_DELAY_MS = 8000;
const DAY_MS = 24 * 60 * 60 * 1000;

type Value = ReturnType<typeof useSubscription>;

function customerInfo(productIdentifier: string | null) {
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

async function mountProvider(): Promise<{ current: Value }> {
  const ref = { current: null as unknown as Value };
  function Consumer() {
    ref.current = useSubscription();
    return null;
  }
  await act(async () => {
    create(
      <SubscriptionProvider>
        <Consumer />
      </SubscriptionProvider>,
    );
  });
  await flush();
  return ref;
}

async function runInitialRefresh(): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(REFRESH_DELAY_MS);
  });
  await flush();
}

describe("SubscriptionProvider", () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    mockSecureStore.clear();
    mockNetworkListener = null;
    await AsyncStorage.clear();
    mockIsNetworkAvailable.mockResolvedValue(true);
    mockGetCustomerInfo.mockResolvedValue(customerInfo(null));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("renders from the SecureStore cache first, before any RevenueCat call", async () => {
    mockSecureStore.set(
      SECURE_KEY,
      JSON.stringify({ appUserId: "rc_user", isSubscribed: true, subscriptionType: "quarterly", timestamp: Date.now() }),
    );

    const value = await mountProvider();

    expect(value.current.isLoading).toBe(false);
    expect(value.current.isSubscribed).toBe(true);
    expect(value.current.subscriptionType).toBe("quarterly");
    expect(value.current.isUsingStaleCache).toBe(false);
    expect(mockGetCustomerInfo).not.toHaveBeenCalled();
  });

  it("ignores a cached entitlement written for another RevenueCat user", async () => {
    // Keychain entries survive a reinstall and are not per account.
    mockSecureStore.set(
      SECURE_KEY,
      JSON.stringify({ appUserId: "someone_else", isSubscribed: true, subscriptionType: "lifetime", timestamp: Date.now() }),
    );

    const value = await mountProvider();

    expect(value.current.isSubscribed).not.toBe(true);
  });

  it("migrates a pre-SecureStore AsyncStorage entry and removes it", async () => {
    await AsyncStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({ isSubscribed: true, subscriptionType: "lifetime", timestamp: Date.now() }),
    );

    const value = await mountProvider();

    expect(value.current.isSubscribed).toBe(true);
    expect(value.current.subscriptionType).toBe("lifetime");
    expect(JSON.parse(mockSecureStore.get(SECURE_KEY) ?? "null")).toMatchObject({
      isSubscribed: true,
      subscriptionType: "lifetime",
    });
    await expect(AsyncStorage.getItem(LEGACY_KEY)).resolves.toBeNull();
  });

  it.each(["{", "[]", '{"isSubscribed":"yes","timestamp":1}', '{"isSubscribed":true}'])(
    "treats a malformed cache %s as no cache",
    async (raw) => {
      mockSecureStore.set(SECURE_KEY, raw);
      const value = await mountProvider();
      expect(value.current.isSubscribed).toBeNull();
      expect(value.current.subscriptionType).toBe("unknown");
    },
  );

  it("keeps an expired cache offline and marks it stale", async () => {
    mockIsNetworkAvailable.mockResolvedValue(false);
    mockSecureStore.set(
      SECURE_KEY,
      JSON.stringify({
        appUserId: "rc_user",
        isSubscribed: true,
        subscriptionType: "quarterly",
        timestamp: Date.now() - 8 * DAY_MS,
      }),
    );

    const value = await mountProvider();
    expect(value.current.isSubscribed).toBe(true);
    expect(value.current.isUsingStaleCache).toBe(true);

    await runInitialRefresh();

    // Offline: the entitlement is still the stale hint, not "free".
    expect(mockGetCustomerInfo).not.toHaveBeenCalled();
    expect(value.current.isSubscribed).toBe(true);
    expect(value.current.isUsingStaleCache).toBe(true);
    expect(value.current.isLoading).toBe(false);
  });

  it("takes RevenueCat's answer online and writes it to SecureStore", async () => {
    mockGetCustomerInfo.mockResolvedValue(customerInfo("meetcal_lifetime"));

    const value = await mountProvider();
    expect(value.current.isSubscribed).toBeNull();

    await runInitialRefresh();

    expect(mockGetCustomerInfo).toHaveBeenCalledTimes(1);
    expect(value.current.isSubscribed).toBe(true);
    expect(value.current.subscriptionType).toBe("lifetime");
    expect(value.current.isUsingStaleCache).toBe(false);
    expect(JSON.parse(mockSecureStore.get(SECURE_KEY) ?? "null")).toMatchObject({
      isSubscribed: true,
      subscriptionType: "lifetime",
    });
    expect(value.current.lastSyncTimestamp).not.toBeNull();
  });

  it("reports an inactive entitlement as free, overriding a stale subscribed cache", async () => {
    mockSecureStore.set(
      SECURE_KEY,
      JSON.stringify({
        appUserId: "rc_user",
        isSubscribed: true,
        subscriptionType: "quarterly",
        timestamp: Date.now() - 8 * DAY_MS,
      }),
    );
    mockGetCustomerInfo.mockResolvedValue(customerInfo(null));

    const value = await mountProvider();
    expect(value.current.isUsingStaleCache).toBe(true);

    await runInitialRefresh();

    expect(value.current.isSubscribed).toBe(false);
    expect(value.current.subscriptionType).toBe("free");
    expect(value.current.isUsingStaleCache).toBe(false);
  });

  it("falls back to the cache when RevenueCat fails and keeps the stale flag honest", async () => {
    mockSecureStore.set(
      SECURE_KEY,
      JSON.stringify({
        appUserId: "rc_user",
        isSubscribed: true,
        subscriptionType: "quarterly",
        timestamp: Date.now() - 8 * DAY_MS,
      }),
    );
    mockGetCustomerInfo.mockRejectedValue(new Error("rc down"));

    const value = await mountProvider();
    await runInitialRefresh();

    expect(value.current.isSubscribed).toBe(true);
    expect(value.current.isUsingStaleCache).toBe(true);
    expect(value.current.isLoading).toBe(false);
  });

  it("goes to unknown when RevenueCat fails and there is no cache", async () => {
    mockGetCustomerInfo.mockRejectedValue(new Error("rc down"));

    const value = await mountProvider();
    await runInitialRefresh();

    expect(value.current.isSubscribed).toBeNull();
    expect(value.current.subscriptionType).toBe("unknown");
    expect(value.current.isUsingStaleCache).toBe(false);
  });

  it("re-checks on reconnect only while running on a stale cache", async () => {
    mockIsNetworkAvailable.mockResolvedValue(false);
    mockSecureStore.set(
      SECURE_KEY,
      JSON.stringify({
        appUserId: "rc_user",
        isSubscribed: true,
        subscriptionType: "quarterly",
        timestamp: Date.now() - 8 * DAY_MS,
      }),
    );

    const value = await mountProvider();
    await runInitialRefresh();
    expect(value.current.isUsingStaleCache).toBe(true);
    expect(mockGetCustomerInfo).not.toHaveBeenCalled();

    mockIsNetworkAvailable.mockResolvedValue(true);
    mockGetCustomerInfo.mockResolvedValue(customerInfo("meetcal_quarterly"));
    await act(async () => {
      mockNetworkListener?.(true);
    });
    await flush();

    expect(mockGetCustomerInfo).toHaveBeenCalledTimes(1);
    expect(value.current.isUsingStaleCache).toBe(false);
    expect(value.current.isSubscribed).toBe(true);

    // Fresh now, so another reconnect does not fire a second check.
    await act(async () => {
      mockNetworkListener?.(true);
    });
    await flush();
    expect(mockGetCustomerInfo).toHaveBeenCalledTimes(1);
  });

  describe("CustomerInfo listener", () => {
    function listener(): (info: unknown) => Promise<void> {
      const add = Purchases.addCustomerInfoUpdateListener as jest.Mock;
      return add.mock.calls[add.mock.calls.length - 1][0];
    }

    it("publishes an active entitlement and writes it to SecureStore", async () => {
      const value = await mountProvider();
      expect(value.current.isSubscribed).toBeNull();

      await act(async () => {
        await listener()(customerInfo("meetcal_quarterly"));
      });
      await flush();

      expect(value.current.isSubscribed).toBe(true);
      expect(value.current.subscriptionType).toBe("quarterly");
      expect(value.current.isLoading).toBe(false);
      expect(JSON.parse(mockSecureStore.get(SECURE_KEY) ?? "null")).toMatchObject({
        appUserId: "rc_user",
        isSubscribed: true,
        subscriptionType: "quarterly",
      });
    });

    it("publishes an empty entitlement as free, over a subscribed cache", async () => {
      mockSecureStore.set(
        SECURE_KEY,
        JSON.stringify({ appUserId: "rc_user", isSubscribed: true, subscriptionType: "lifetime", timestamp: Date.now() }),
      );
      const value = await mountProvider();
      expect(value.current.isSubscribed).toBe(true);

      await act(async () => {
        await listener()(customerInfo(null));
      });
      await flush();

      expect(value.current.isSubscribed).toBe(false);
      expect(value.current.subscriptionType).toBe("free");
      expect(JSON.parse(mockSecureStore.get(SECURE_KEY) ?? "null")).toMatchObject({
        isSubscribed: false,
        subscriptionType: "free",
      });
    });
  });

  it("does nothing after unmounting while the SecureStore read is pending", async () => {
    const getItem = jest.requireMock("expo-secure-store").getItemAsync as jest.Mock;
    let finishRead!: (raw: string | null) => void;
    getItem.mockImplementationOnce(
      () => new Promise<string | null>((resolve) => {
        finishRead = resolve;
      }),
    );
    const renders: (boolean | null)[] = [];
    function Consumer() {
      renders.push(useSubscription().isSubscribed);
      return null;
    }
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        <SubscriptionProvider>
          <Consumer />
        </SubscriptionProvider>,
      );
    });
    await flush();
    await act(async () => {
      renderer.unmount();
    });
    const rendersAtUnmount = renders.length;

    await act(async () => {
      finishRead(
        JSON.stringify({ appUserId: "rc_user", isSubscribed: true, subscriptionType: "quarterly", timestamp: Date.now() }),
      );
    });
    await runInitialRefresh();

    expect(renders.length).toBe(rendersAtUnmount);
    expect(renders).not.toContain(true);
    expect(mockGetCustomerInfo).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("reports a failed restore as not subscribed and keeps the current state", async () => {
    (Purchases.restorePurchases as jest.Mock).mockRejectedValue(new Error("store down"));
    const value = await mountProvider();

    let restored: boolean | undefined;
    await act(async () => {
      restored = await value.current.restorePurchases();
    });

    expect(restored).toBe(false);
    expect(value.current.isSubscribed).toBeNull();
    expect(mockSecureStore.has(SECURE_KEY)).toBe(false);
  });
});
