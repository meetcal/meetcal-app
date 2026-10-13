import { createContext, useCallback, useContext, useEffect, useEffectEvent, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import Purchases, { CustomerInfo } from 'react-native-purchases';
import { OneSignal } from 'react-native-onesignal';
import { getSimulatedSubscriptionStatus } from '@/config/development';
import { isNetworkAvailable, subscribeToNetworkChanges } from '@/lib/networkUtils';
import { devLog, devWarn } from '@/lib/logger';
import { SUBSCRIPTION_ENTITLEMENT_ID } from '@/lib/premium-intent';

/**
 * `setSubscribed` is a provider internal, not part of this contract:
 * entitlement is server truth (RevenueCat), so a screen that could write it
 * locally is a bug waiting to happen. The provider keeps itself in sync via
 * its own RevenueCat listener and reconnect effect; `recheckSubscription`
 * only asks RevenueCat again.
 */
type SubscriptionContextType = {
  isSubscribed: boolean | null;
  subscriptionType: 'free' | 'quarterly' | 'lifetime' | 'unknown' | null;
  isLoading: boolean;
  /**
   * Manual restore. No screen calls this today — the paywall uses
   * RevenueCatUI's own restore button and only handles `onRestoreCompleted` —
   * but a first-party "Restore Purchases" row is a store requirement the
   * moment the app ships a non-RevenueCatUI purchase surface, so the working
   * implementation stays exposed rather than being deleted and rewritten.
   */
  restorePurchases: () => Promise<boolean>;
  /**
   * Ask RevenueCat again (falling back to the cache offline). For the
   * "can't confirm your subscription" state's Retry; it never writes an
   * entitlement the server did not report.
   */
  recheckSubscription: () => void;
  isUsingStaleCache: boolean;
  lastSyncTimestamp: number | null;
  /**
   * The entitlement as RevenueCat (or a restore, or the dev simulation)
   * reported it in this process; `null` until it has answered. Never the
   * SecureStore cache, which `isSubscribed` starts from: for destructive
   * writes that a subscription gates (the auto-remove prune), where a stale
   * "subscribed" would delete a lapsed user's sessions.
   */
  confirmedIsSubscribed: boolean | null;
};

interface SubscriptionCacheData {
  isSubscribed: boolean;
  subscriptionType: 'free' | 'quarterly' | 'lifetime' | 'unknown';
  timestamp: number;
  /**
   * RevenueCat app user id the entry was written for. Keychain items survive
   * an uninstall and are not per account, while RevenueCat's id lives in app
   * storage; an entry for a different id is someone else's (or a previous
   * install's) entitlement and is ignored.
   */
  appUserId?: string;
}

type SubscriptionCacheEntry = SubscriptionCacheData & {
  isExpired: boolean;
};

/**
 * The entitlement hint lives in SecureStore (keychain / keystore), like the
 * auth cache. In plain AsyncStorage it was a world-readable JSON file that a
 * rooted device could flip to `isSubscribed: true`; gating is client-only,
 * so that flag was the whole gate. This does not make the client a source of
 * truth — RevenueCat is — it just stops the cache being a trivial edit.
 */
const SUBSCRIPTION_CACHE_KEY = 'subscription_cache_v3';
/** Pre-SecureStore AsyncStorage key; read once, migrated, then removed. */
const LEGACY_SUBSCRIPTION_CACHE_KEY = 'subscription_cache_v2';
const SUBSCRIPTION_CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function parseSubscriptionCache(raw: string | null): SubscriptionCacheData | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.isSubscribed !== 'boolean') return null;
  if (typeof record.timestamp !== 'number' || !Number.isFinite(record.timestamp)) return null;
  const type = record.subscriptionType;
  const subscriptionType: SubscriptionCacheData['subscriptionType'] =
    type === 'free' || type === 'quarterly' || type === 'lifetime' || type === 'unknown'
      ? type
      : 'unknown';
  return {
    isSubscribed: record.isSubscribed,
    subscriptionType,
    timestamp: record.timestamp,
    ...(typeof record.appUserId === 'string' ? { appUserId: record.appUserId } : {}),
  };
}

/** The current RevenueCat app user id, or null when the SDK cannot say. */
async function currentAppUserId(): Promise<string | null> {
  try {
    const id = await Purchases.getAppUserID();
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

/**
 * Read the cached entitlement, moving a pre-SecureStore entry across on
 * first sight so an existing subscriber does not open the app offline to a
 * paywall after updating.
 */
export async function readSubscriptionCache(): Promise<SubscriptionCacheData | null> {
  const appUserId = await currentAppUserId();
  const secure = parseSubscriptionCache(await SecureStore.getItemAsync(SUBSCRIPTION_CACHE_KEY));
  if (secure) {
    // Written for another RevenueCat user, or unstamped: a previous install's
    // or another account's entitlement. The next online check replaces it.
    if (appUserId !== null && secure.appUserId !== appUserId) return null;
    return secure;
  }

  // AsyncStorage does not survive a reinstall, so a legacy entry belongs to
  // this install; stamp it with the current user as it moves across.
  const legacyRaw = await AsyncStorage.getItem(LEGACY_SUBSCRIPTION_CACHE_KEY).catch(() => null);
  if (legacyRaw === null) return null;
  const parsedLegacy = parseSubscriptionCache(legacyRaw);
  const legacy = parsedLegacy
    ? { ...parsedLegacy, ...(appUserId ? { appUserId } : {}) }
    : null;
  if (legacy) {
    await SecureStore.setItemAsync(SUBSCRIPTION_CACHE_KEY, JSON.stringify(legacy));
  }
  await AsyncStorage.removeItem(LEGACY_SUBSCRIPTION_CACHE_KEY).catch(() => undefined);
  return legacy;
}

export async function writeSubscriptionCache(data: SubscriptionCacheData): Promise<void> {
  const appUserId = data.appUserId ?? (await currentAppUserId());
  await SecureStore.setItemAsync(
    SUBSCRIPTION_CACHE_KEY,
    JSON.stringify(appUserId ? { ...data, appUserId } : data),
  );
}

/**
 * How long the cache-first render holds before the first RevenueCat round
 * trip. Long enough that the network check never competes with first paint or
 * the paywall's own fetch.
 */
const INITIAL_REFRESH_DELAY_MS = 8000;

/**
 * How many times a check re-asks RevenueCat when its app user id changed
 * while the request was out (Clerk signing in, or out, mid-check). Past this
 * the check fails into the cache fallback rather than chasing a flapping
 * identity.
 */
const MAX_IDENTITY_ATTEMPTS = 3;

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [isSubscribed, setIsSubscribed] = useState<boolean | null>(null);
  const [subscriptionType, setSubscriptionType] = useState<'free' | 'quarterly' | 'lifetime' | 'unknown' | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUsingStaleCache, setIsUsingStaleCache] = useState(false);
  const [lastSyncTimestamp, setLastSyncTimestamp] = useState<number | null>(null);
  const [confirmedIsSubscribed, setConfirmedIsSubscribed] = useState<boolean | null>(null);
  const confirmedMembershipRef = useRef<{
    subscribed: boolean;
    type: 'free' | 'quarterly' | 'lifetime';
  } | null>(null);

  // Entitlement answers come from three places that race: a check
  // (`getCustomerInfo`), RevenueCat's CustomerInfo listener, and a restore.
  // On a fresh install the first check starts as the anonymous user while the
  // root layout's `Purchases.logIn` runs, so the anonymous "free" answer could
  // land after the listener published the signed-in user's purchase and take
  // it away. Each answer takes a generation when it starts and is dropped,
  // state and cache alike, if a newer one has started since.
  const generationRef = useRef(0);
  const beginAnswer = useCallback(() => {
    generationRef.current += 1;
    return generationRef.current;
  }, []);
  const isCurrentAnswer = useCallback(
    (generation: number) => generation === generationRef.current,
    [],
  );
  // SecureStore writes are serialized so the last write is the newest answer.
  const cacheWriteRef = useRef<Promise<void>>(Promise.resolve());

  // These are app-owned tags. RevenueCat's native OneSignal integration covers
  // auto-renewing subscription events; this entitlement-based tag also covers
  // non-renewing lifetime purchases.
  const syncOneSignalMembershipTags = useCallback(async (
    subscribed: boolean,
    type: 'free' | 'quarterly' | 'lifetime'
  ) => {
    try {
      const [oneSignalExternalId, revenueCatAppUserId] = await Promise.all([
        OneSignal.User.getExternalId(),
        Purchases.getAppUserID(),
      ]);

      // CustomerInfo can update while the auth providers are switching users.
      // Only tag OneSignal when both SDKs are confirmed to represent the same user.
      if (!oneSignalExternalId || oneSignalExternalId !== revenueCatAppUserId) {
        return;
      }

      OneSignal.User.addTags({
        is_paid_member: subscribed ? 'true' : 'false',
        membership_type: subscribed ? type : 'free',
      });
    } catch (error) {
      console.warn('Failed to sync OneSignal membership tags:', error);
    }
  }, []);

  const recordConfirmedMembership = useCallback((
    subscribed: boolean,
    type: 'free' | 'quarterly' | 'lifetime'
  ) => {
    confirmedMembershipRef.current = { subscribed, type };
    setConfirmedIsSubscribed(subscribed);
    void syncOneSignalMembershipTags(subscribed, type);
  }, [syncOneSignalMembershipTags]);

  // A CustomerInfo refresh can finish before OneSignal finishes switching to the
  // signed-in user. Retry the latest confirmed status when that identity arrives.
  useEffect(() => {
    const retryMembershipTagSync = () => {
      const membership = confirmedMembershipRef.current;
      if (membership) {
        void syncOneSignalMembershipTags(
          membership.subscribed,
          membership.type
        );
      }
    };

    OneSignal.User.addEventListener('change', retryMembershipTagSync);
    return () => {
      OneSignal.User.removeEventListener('change', retryMembershipTagSync);
    };
  }, [syncOneSignalMembershipTags]);

  // Save an answer to the cache, after any earlier write and only while it
  // is still the newest answer. `appUserId` is who the answer is about when
  // the caller knows; otherwise the id at write time.
  const saveSubscriptionCache = useCallback((
    generation: number,
    subscribed: boolean,
    type: 'free' | 'quarterly' | 'lifetime',
    appUserId?: string | null,
  ): Promise<void> => {
    const write = cacheWriteRef.current.then(async () => {
      if (!isCurrentAnswer(generation)) return;
      try {
        const cacheData: SubscriptionCacheData = {
          isSubscribed: subscribed,
          subscriptionType: type,
          timestamp: Date.now(),
          ...(appUserId ? { appUserId } : {}),
        };
        await writeSubscriptionCache(cacheData);
        if (!isCurrentAnswer(generation)) return;
        setLastSyncTimestamp(cacheData.timestamp);
        setIsUsingStaleCache(false);
        devLog('Subscription cache saved:', cacheData);
      } catch (error) {
        console.error('Error saving subscription cache:', error);
      }
    });
    cacheWriteRef.current = write;
    return write;
  }, [isCurrentAnswer]);

  // Helper function to get subscription from cache
  const getSubscriptionCache = async (
    markStaleCache = false
  ): Promise<SubscriptionCacheEntry | null> => {
    try {
      const cacheData = await readSubscriptionCache();
      if (!cacheData) return null;
      const now = Date.now();
      const isExpired = now - cacheData.timestamp > SUBSCRIPTION_CACHE_EXPIRY_MS;

      if (isExpired && markStaleCache) {
        devLog('Subscription cache expired (older than 7 days), using stale');
        setIsUsingStaleCache(true);
      }

      setLastSyncTimestamp(cacheData.timestamp);
      if (!isExpired || markStaleCache) {
        setIsUsingStaleCache(isExpired);
      }
      return { ...cacheData, isExpired };
    } catch (error) {
      console.error('Error getting subscription cache:', error);
      return null;
    }
  };

  // Helper function to check subscription status consistently
  const checkEntitlementStatus = async (customerInfo: CustomerInfo): Promise<[boolean, 'free' | 'quarterly' | 'lifetime']> => {
    // Check for simulated subscription first
    const simulatedStatus = getSimulatedSubscriptionStatus();
    if (simulatedStatus !== null) {
      devLog('Using simulated subscription status:', simulatedStatus);
      return [simulatedStatus, simulatedStatus ? 'quarterly' : 'free'];
    }

    const hasActiveEntitlement = customerInfo.entitlements.active[SUBSCRIPTION_ENTITLEMENT_ID] != null;
    let subscriptionType: 'free' | 'quarterly' | 'lifetime' = 'free';

    if (hasActiveEntitlement) {
      // Check the specific product identifier or entitlement to determine type
      const entitlement = customerInfo.entitlements.active[SUBSCRIPTION_ENTITLEMENT_ID];
      if (entitlement?.productIdentifier.includes('lifetime')) {
        subscriptionType = 'lifetime';
      } else {
        subscriptionType = 'quarterly';
      }
    }

    devLog('Checking entitlement status:', { hasActiveEntitlement, subscriptionType });
    
    return [hasActiveEntitlement, subscriptionType];
  };

  // An Effect Event: only the effects below call it (the delayed refresh and
  // the reconnect listener), always at its latest version, without making it
  // a dependency that would re-run the initialization or re-subscribe.
  const checkSubscriptionStatus = useEffectEvent(async () => {
    const generation = beginAnswer();
    try {
      devLog('Checking subscription status...');
      setIsLoading(true);

      // Check for simulated subscription first
      const simulatedStatus = getSimulatedSubscriptionStatus();
      if (simulatedStatus !== null) {
        devLog('Using simulated subscription status:', simulatedStatus);
        const type = simulatedStatus ? 'quarterly' : 'free';
        setIsSubscribed(simulatedStatus);
        setConfirmedIsSubscribed(simulatedStatus);
        setSubscriptionType(type);
        setIsLoading(false);
        await saveSubscriptionCache(generation, simulatedStatus, type);
        return;
      }

      // Check network availability before attempting RevenueCat call
      const hasNetwork = await isNetworkAvailable();
      if (!isCurrentAnswer(generation)) return;

      if (!hasNetwork) {
        devLog('No network available, using cached subscription data');
        const cached = await getSubscriptionCache(true);
        if (!isCurrentAnswer(generation)) return;
        if (cached) {
          setIsSubscribed(cached.isSubscribed);
          setSubscriptionType(cached.subscriptionType);
        } else {
          devWarn('No network and no cache available, setting unknown state');
          setIsSubscribed(null);
          setSubscriptionType('unknown');
        }
        setIsLoading(false);
        return;
      }

      // Network available, check real subscription. CustomerInfo is for the
      // app user id current when the request went out; if that changed by
      // the time it answered, it describes the previous identity, so ask
      // again for the new one.
      for (let attempt = 0; attempt < MAX_IDENTITY_ATTEMPTS; attempt += 1) {
        const requestedFor = await currentAppUserId();
        const customerInfo = await Purchases.getCustomerInfo();
        if (!isCurrentAnswer(generation)) return;
        const answeredFor = await currentAppUserId();
        if (!isCurrentAnswer(generation)) return;
        if (requestedFor !== answeredFor) {
          devLog('RevenueCat user changed during the subscription check, asking again');
          continue;
        }

        const [hasActiveSubscription, type] = await checkEntitlementStatus(customerInfo);
        devLog('Real subscription status:', { hasActiveSubscription, type });

        recordConfirmedMembership(hasActiveSubscription, type);
        setIsSubscribed(hasActiveSubscription);
        setSubscriptionType(type);
        setIsLoading(false);
        await saveSubscriptionCache(generation, hasActiveSubscription, type, answeredFor);
        return;
      }
      throw new Error('RevenueCat user kept changing during the subscription check');
    } catch (error) {
      if (!isCurrentAnswer(generation)) return;
      console.error('Failed to check subscription status:', error);
      // On error, try to get status from cache
      const cached = await getSubscriptionCache(false);
      if (!isCurrentAnswer(generation)) return;
      if (cached) {
        setIsSubscribed(cached.isSubscribed);
        setSubscriptionType(cached.subscriptionType);
        // Keep the stale flag honest: forcing it to false when the entry is
        // past its 7-day expiry stops the reconnect effect from ever
        // re-checking, so an expired entitlement stays "subscribed" for the
        // rest of the session. The offline path already does this.
        setIsUsingStaleCache(cached.isExpired);
      } else {
        devWarn('Error checking subscription and no cache available, setting unknown state');
        setIsSubscribed(null);
        setSubscriptionType('unknown');
        setIsUsingStaleCache(false);
      }
      setIsLoading(false);
    }
  });

  // Initialize subscription status - cache-first, no blocking network check
  useEffect(() => {
    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const initializeStatus = async () => {
      // The cache is the oldest answer there is: if RevenueCat answered
      // (the listener) during the SecureStore read, it must not be replaced.
      const startGeneration = generationRef.current;
      setIsLoading(true);
      try {
        const simulatedStatus = getSimulatedSubscriptionStatus();
        if (simulatedStatus !== null) {
          const type = simulatedStatus ? 'quarterly' : 'free';
          setIsSubscribed(simulatedStatus);
          setConfirmedIsSubscribed(simulatedStatus);
          setSubscriptionType(type);
          setIsLoading(false);
          return;
        }

        const cached = await getSubscriptionCache(false);
        // `cancelled` guarded only the timeout below, so a provider that
        // unmounted (or re-mounted on sign-out) during the SecureStore read
        // still published the old user's entitlement.
        if (cancelled) return;
        const superseded = generationRef.current !== startGeneration;
        if (superseded) {
          // Already answered; just keep the delayed refresh below.
        } else if (cached) {
          setIsSubscribed(cached.isSubscribed);
          setSubscriptionType(cached.subscriptionType);
        } else {
          setIsSubscribed(null);
          setSubscriptionType('unknown');
        }

        if (cached?.isExpired && !superseded) {
          setIsUsingStaleCache(true);
        }

        // With nothing cached there is nothing to paint first, and waiting
        // out the delay published "unknown" (not loading) for 8 s, so every
        // premium surface told a subscriber on a fresh install that it could
        // not confirm the subscription. Check now; `isLoading` stays true
        // until it answers.
        if (!cached && !superseded) {
          void checkSubscriptionStatus();
          return;
        }
        if (!superseded) setIsLoading(false);

        refreshTimeout = setTimeout(() => {
          if (!cancelled) {
            void checkSubscriptionStatus();
          }
        }, INITIAL_REFRESH_DELAY_MS);
      } catch (error) {
        console.error('Failed to initialize subscription status:', error);
        if (!cancelled) setIsLoading(false);
      }
    };

    initializeStatus();

    return () => {
      cancelled = true;
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
      }
    };
  }, []);

  // Listen for RevenueCat updates
  useEffect(() => {
    let customerInfoUpdateListener: (() => void) | undefined;

    const setupListener = async () => {
      try {
        const listener = async (info: CustomerInfo) => {
          // RevenueCat pushes this for the current user (after `logIn`, a
          // purchase, a renewal), so it supersedes any check still in flight.
          const generation = beginAnswer();
          // Never log the whole CustomerInfo: it carries the RevenueCat app
          // user id, purchase dates, and store transaction ids.
          devLog('Customer info updated. Active entitlements:', Object.keys(info.entitlements.active));
          setIsLoading(true);
          const [hasActiveSubscription, type] = await checkEntitlementStatus(info);
          if (!isCurrentAnswer(generation)) return;
          devLog('Subscription update received:', { hasActiveSubscription, type });

          recordConfirmedMembership(hasActiveSubscription, type);
          setIsSubscribed(hasActiveSubscription);
          setSubscriptionType(type);
          setIsLoading(false);
          await saveSubscriptionCache(generation, hasActiveSubscription, type);
        };

        Purchases.addCustomerInfoUpdateListener(listener);
        customerInfoUpdateListener = () => Purchases.removeCustomerInfoUpdateListener(listener);
      } catch (error) {
        console.error('Failed to setup customer info listener:', error);
        setIsLoading(false);
      }
    };

    setupListener();

    return () => {
      if (customerInfoUpdateListener) {
        customerInfoUpdateListener();
      }
    };
  }, [recordConfirmedMembership, beginAnswer, isCurrentAnswer, saveSubscriptionCache]);

  // Refresh when coming back online. Subscribed once, reading the latest
  // state through an Effect Event: NetInfo calls a listener with the current
  // state as soon as it subscribes, so an effect re-subscribing on every
  // `isLoading` flip re-ran the check each time one finished, and a check
  // that failed while online looped forever. Only a change to "connected"
  // counts, and never while a check is already in flight.
  const lastConnectedRef = useRef<boolean | null>(null);
  const onNetworkChange = useEffectEvent(async (isConnected: boolean) => {
    devLog('Network state changed:', isConnected);
    const wasConnected = lastConnectedRef.current;
    lastConnectedRef.current = isConnected;
    if (!isConnected || wasConnected === true || isLoading) return;

    // Unknown (offline with no cache, or a failed check) recovers the same
    // way a stale cache does.
    if (isUsingStaleCache || isSubscribed === null) {
      devLog('Network restored with a stale or unknown entitlement, refreshing subscription...');
      await checkSubscriptionStatus();
    }
  });
  useEffect(() => {
    const unsubscribe = subscribeToNetworkChanges((isConnected) => {
      void onNetworkChange(isConnected);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // `checkSubscriptionStatus` is an Effect Event, callable only from effects,
  // so a Retry tap requests a check and this effect runs it.
  const [recheckRequest, setRecheckRequest] = useState(0);
  useEffect(() => {
    if (recheckRequest === 0) return;
    void checkSubscriptionStatus();
  }, [recheckRequest]);
  const recheckSubscription = useCallback(() => {
    setRecheckRequest((count) => count + 1);
  }, []);

  const setSubscribed = async (
    generation: number,
    value: boolean,
    type: 'free' | 'quarterly' | 'lifetime',
  ) => {
    if (!isCurrentAnswer(generation)) return;
    try {
      recordConfirmedMembership(value, type);
      setIsSubscribed(value);
      setSubscriptionType(type);
      // A check this answer superseded will not clear its own loading flag.
      setIsLoading(false);
      await saveSubscriptionCache(generation, value, type);
    } catch (e) {
      console.error('Failed to save subscription status:', e);
    }
  };

  const restorePurchases = async (): Promise<boolean> => {
    try {
      devLog('Attempting to restore purchases...');
      const customerInfo = await Purchases.restorePurchases();
      // Taken once there is an answer: a failed restore leaves state alone,
      // and must not orphan a check still in flight.
      const generation = beginAnswer();
      const [hasActiveSubscription, type] = await checkEntitlementStatus(customerInfo);
      devLog('Restore purchases result:', { hasActiveSubscription, type });

      await setSubscribed(generation, hasActiveSubscription, type);
      return hasActiveSubscription;
    } catch (error) {
      console.error('Failed to restore purchases:', error);
      return false;
    }
  };

  return (
    <SubscriptionContext.Provider
      value={{
        isSubscribed,
        subscriptionType,
        isLoading,
        restorePurchases,
        recheckSubscription,
        isUsingStaleCache,
        lastSyncTimestamp,
        confirmedIsSubscribed,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const context = useContext(SubscriptionContext);
  if (context === undefined) {
    throw new Error('useSubscription must be used within a SubscriptionProvider');
  }
  return context;
} 
