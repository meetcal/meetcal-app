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
// Real NetInfo calls a new listener with the current state at once; `null`
// keeps the mock quiet on subscribe.
let mockConnectedOnSubscribe: boolean | null = null;
let mockNetworkSubscriptions = 0;
jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(async () => true),
  subscribeToNetworkChanges: (callback: (isConnected: boolean) => void) => {
    mockNetworkSubscriptions += 1;
    mockNetworkListener = callback;
    if (mockConnectedOnSubscribe !== null) callback(mockConnectedOnSubscribe);
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
    mockConnectedOnSubscribe = null;
    mockNetworkSubscriptions = 0;
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
      // RevenueCat has not answered yet: unknown, and still loading.
      mockGetCustomerInfo.mockReturnValue(new Promise(() => {}));
      const value = await mountProvider();
      expect(value.current.isSubscribed).toBeNull();
      expect(value.current.subscriptionType).toBe("unknown");
      expect(value.current.isLoading).toBe(true);
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

  it("with no cache, takes RevenueCat's answer at once and writes it to SecureStore", async () => {
    mockGetCustomerInfo.mockResolvedValue(customerInfo("meetcal_lifetime"));

    const value = await mountProvider();

    // No 8 s hold: with nothing cached, "unknown, not loading" would tell a
    // subscriber every premium surface could not confirm the subscription.
    expect(mockGetCustomerInfo).toHaveBeenCalledTimes(1);
    expect(value.current.isLoading).toBe(false);

    // And no second, delayed check on top of it.
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

  it("offline with no cache, is unknown (not loading) and re-checks on reconnect", async () => {
    mockIsNetworkAvailable.mockResolvedValue(false);

    const value = await mountProvider();
    expect(value.current.isSubscribed).toBeNull();
    expect(value.current.subscriptionType).toBe("unknown");
    expect(value.current.isLoading).toBe(false);
    expect(mockGetCustomerInfo).not.toHaveBeenCalled();

    mockIsNetworkAvailable.mockResolvedValue(true);
    mockGetCustomerInfo.mockResolvedValue(customerInfo("meetcal_quarterly"));
    await act(async () => {
      mockNetworkListener?.(true);
    });
    await flush();

    expect(mockGetCustomerInfo).toHaveBeenCalledTimes(1);
    expect(value.current.isSubscribed).toBe(true);
  });

  it("does not loop checks when RevenueCat fails while online", async () => {
    // A listener that fires on subscribe plus an effect that re-subscribed on
    // every `isLoading` flip re-ran a failing check forever.
    mockConnectedOnSubscribe = true;
    // Fails, and after a few calls stops answering, so a regression fails
    // the assertion below instead of spinning the test forever.
    mockGetCustomerInfo.mockImplementation(() =>
      mockGetCustomerInfo.mock.calls.length > 5
        ? new Promise(() => {})
        : Promise.reject(new Error("rc down")),
    );

    const value = await mountProvider();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(REFRESH_DELAY_MS * 3);
    });
    await flush();

    expect(mockGetCustomerInfo).toHaveBeenCalledTimes(1);
    expect(mockNetworkSubscriptions).toBe(1);
    expect(value.current.isSubscribed).toBeNull();
    expect(value.current.isLoading).toBe(false);
  });

  it("recheckSubscription asks RevenueCat again", async () => {
    mockIsNetworkAvailable.mockResolvedValue(false);
    const value = await mountProvider();
    expect(value.current.isSubscribed).toBeNull();

    mockIsNetworkAvailable.mockResolvedValue(true);
    mockGetCustomerInfo.mockResolvedValue(customerInfo(null));
    await act(async () => {
      value.current.recheckSubscription();
    });
    await flush();

    expect(mockGetCustomerInfo).toHaveBeenCalledTimes(1);
    expect(value.current.isSubscribed).toBe(false);
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
      mockGetCustomerInfo.mockReturnValue(new Promise(() => {}));
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

  describe("racing answers", () => {
    const getAppUserID = Purchases.getAppUserID as jest.Mock;
    function listener(): (info: unknown) => Promise<void> {
      const add = Purchases.addCustomerInfoUpdateListener as jest.Mock;
      return add.mock.calls[add.mock.calls.length - 1][0];
    }
    function deferred<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    }

    let appUserId = "$RCAnonymousID:install";
    beforeEach(() => {
      appUserId = "$RCAnonymousID:install";
      getAppUserID.mockImplementation(async () => appUserId);
    });
    afterEach(() => {
      getAppUserID.mockImplementation(async () => "rc_user");
    });

    it("keeps a signed-in purchase when an anonymous check started before logIn answers last", async () => {
      // Fresh install: no cache, so the provider checks at once, as the
      // anonymous user, while the root layout signs in to RevenueCat.
      const anonymousCheck = deferred<unknown>();
      mockGetCustomerInfo.mockReturnValueOnce(anonymousCheck.promise as never);
      const value = await mountProvider();
      expect(mockGetCustomerInfo).toHaveBeenCalledTimes(1);

      // `Purchases.logIn("user_a")` switches identity and RevenueCat pushes
      // user A's lifetime purchase through the listener.
      appUserId = "user_a";
      await act(async () => {
        await listener()(customerInfo("meetcal_lifetime"));
      });
      await flush();
      expect(value.current.subscriptionType).toBe("lifetime");

      // The anonymous check now answers "free".
      await act(async () => {
        anonymousCheck.resolve(customerInfo(null));
      });
      await flush();

      expect(value.current.isSubscribed).toBe(true);
      expect(value.current.subscriptionType).toBe("lifetime");
      expect(value.current.isLoading).toBe(false);
      expect(JSON.parse(mockSecureStore.get(SECURE_KEY) ?? "null")).toMatchObject({
        appUserId: "user_a",
        isSubscribed: true,
        subscriptionType: "lifetime",
      });
    });

    it("asks again when the RevenueCat user changes mid-check and no listener update arrives", async () => {
      const anonymousCheck = deferred<unknown>();
      mockGetCustomerInfo
        .mockReturnValueOnce(anonymousCheck.promise as never)
        .mockResolvedValueOnce(customerInfo("meetcal_quarterly"));
      const value = await mountProvider();

      appUserId = "user_a";
      await act(async () => {
        anonymousCheck.resolve(customerInfo(null));
      });
      await flush();

      // The anonymous "free" is never published or cached for user A.
      expect(mockGetCustomerInfo).toHaveBeenCalledTimes(2);
      expect(value.current.isSubscribed).toBe(true);
      expect(value.current.subscriptionType).toBe("quarterly");
      expect(JSON.parse(mockSecureStore.get(SECURE_KEY) ?? "null")).toMatchObject({
        appUserId: "user_a",
        isSubscribed: true,
      });
    });

    it("lets a newer check win over an older one that answers later", async () => {
      appUserId = "user_a";
      const olderCheck = deferred<unknown>();
      mockGetCustomerInfo.mockReturnValueOnce(olderCheck.promise as never);
      const value = await mountProvider();

      // Retry while the first check is still out; RevenueCat now says
      // quarterly (a purchase just landed).
      mockGetCustomerInfo.mockResolvedValueOnce(customerInfo("meetcal_quarterly"));
      await act(async () => {
        value.current.recheckSubscription();
      });
      await flush();
      expect(value.current.subscriptionType).toBe("quarterly");

      await act(async () => {
        olderCheck.resolve(customerInfo(null));
      });
      await flush();

      expect(value.current.isSubscribed).toBe(true);
      expect(value.current.subscriptionType).toBe("quarterly");
      expect(value.current.isLoading).toBe(false);
    });

    it("drops a check a listener update superseded, without leaving the provider loading", async () => {
      appUserId = "user_a";
      const check = deferred<unknown>();
      mockGetCustomerInfo.mockReturnValueOnce(check.promise as never);
      const value = await mountProvider();
      expect(value.current.isLoading).toBe(true);

      await act(async () => {
        await listener()(customerInfo(null));
      });
      await flush();
      await act(async () => {
        check.resolve(customerInfo("meetcal_quarterly"));
      });
      await flush();

      expect(value.current.isLoading).toBe(false);
      expect(value.current.subscriptionType).toBe("free");
    });
  });

  it("initializes and runs the delayed refresh once, however often the provider re-renders", async () => {
    mockGetCustomerInfo.mockResolvedValue(customerInfo("meetcal_quarterly"));
    const addListener = Purchases.addCustomerInfoUpdateListener as jest.Mock;

    function Child({ label }: { label: string }) {
      useSubscription();
      return <>{label}</>;
    }
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <SubscriptionProvider>
          <Child label="first" />
        </SubscriptionProvider>,
      );
    });
    await flush();
    for (const label of ["second", "third", "fourth"]) {
      await act(async () => {
        tree.update(
          <SubscriptionProvider>
            <Child label={label} />
          </SubscriptionProvider>,
        );
      });
    }
    await flush();

    await runInitialRefresh();
    // The refresh's own state updates re-render the provider too.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(REFRESH_DELAY_MS * 3);
    });
    await flush();

    expect(mockGetCustomerInfo).toHaveBeenCalledTimes(1);
    expect(addListener).toHaveBeenCalledTimes(1);
    await act(async () => {
      tree.unmount();
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
    // Offline with no cache: the state to keep is "unknown".
    mockIsNetworkAvailable.mockResolvedValue(false);
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
