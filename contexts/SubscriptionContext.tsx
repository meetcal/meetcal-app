import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Purchases, { CustomerInfo } from 'react-native-purchases';
import { OneSignal } from 'react-native-onesignal';
import { getSimulatedSubscriptionStatus } from '@/config/development';
import { isNetworkAvailable, subscribeToNetworkChanges } from '@/lib/networkUtils';
import { devLog, devWarn } from '@/lib/logger';

/**
 * `setSubscribed` and `checkSubscriptionStatus` are provider internals, not
 * part of this contract: entitlement is server truth (RevenueCat), so a screen
 * that could write it locally is a bug waiting to happen. The provider keeps
 * itself in sync via its own RevenueCat listener and reconnect effect.
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
  isUsingStaleCache: boolean;
  lastSyncTimestamp: number | null;
};

interface SubscriptionCacheData {
  isSubscribed: boolean;
  subscriptionType: 'free' | 'quarterly' | 'lifetime' | 'unknown';
  timestamp: number;
}

type SubscriptionCacheEntry = SubscriptionCacheData & {
  isExpired: boolean;
};

const SUBSCRIPTION_CACHE_KEY = 'subscription_cache_v2';
const SUBSCRIPTION_CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * How long the cache-first render holds before the first RevenueCat round
 * trip. Long enough that the network check never competes with first paint or
 * the paywall's own fetch.
 */
const INITIAL_REFRESH_DELAY_MS = 8000;

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [isSubscribed, setIsSubscribed] = useState<boolean | null>(null);
  const [subscriptionType, setSubscriptionType] = useState<'free' | 'quarterly' | 'lifetime' | 'unknown' | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUsingStaleCache, setIsUsingStaleCache] = useState(false);
  const [lastSyncTimestamp, setLastSyncTimestamp] = useState<number | null>(null);
  const confirmedMembershipRef = useRef<{
    subscribed: boolean;
    type: 'free' | 'quarterly' | 'lifetime';
  } | null>(null);

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

  // Helper function to save subscription to cache with timestamp
  const saveSubscriptionCache = async (
    subscribed: boolean,
    type: 'free' | 'quarterly' | 'lifetime'
  ) => {
    try {
      const cacheData: SubscriptionCacheData = {
        isSubscribed: subscribed,
        subscriptionType: type,
        timestamp: Date.now(),
      };
      await AsyncStorage.setItem(SUBSCRIPTION_CACHE_KEY, JSON.stringify(cacheData));
      setLastSyncTimestamp(cacheData.timestamp);
      setIsUsingStaleCache(false);
      devLog('Subscription cache saved:', cacheData);
    } catch (error) {
      console.error('Error saving subscription cache:', error);
    }
  };

  // Helper function to get subscription from cache
  const getSubscriptionCache = async (
    markStaleCache = false
  ): Promise<SubscriptionCacheEntry | null> => {
    try {
      const cached = await AsyncStorage.getItem(SUBSCRIPTION_CACHE_KEY);
      if (!cached) return null;

      const parsed: unknown = JSON.parse(cached);
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        typeof (parsed as SubscriptionCacheData).isSubscribed !== 'boolean' ||
        typeof (parsed as SubscriptionCacheData).timestamp !== 'number'
      ) {
        return null;
      }
      const cacheData = parsed as SubscriptionCacheData;
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

    const hasActiveEntitlement = customerInfo.entitlements.active['Subscriptions'] != null;
    let subscriptionType: 'free' | 'quarterly' | 'lifetime' = 'free';

    if (hasActiveEntitlement) {
      // Check the specific product identifier or entitlement to determine type
      const entitlement = customerInfo.entitlements.active['Subscriptions'];
      if (entitlement?.productIdentifier.includes('lifetime')) {
        subscriptionType = 'lifetime';
      } else {
        subscriptionType = 'quarterly';
      }
    }

    devLog('Checking entitlement status:', { hasActiveEntitlement, subscriptionType });
    
    return [hasActiveEntitlement, subscriptionType];
  };

  const checkSubscriptionStatus = async () => {
    try {
      devLog('Checking subscription status...');
      setIsLoading(true);

      // Check for simulated subscription first
      const simulatedStatus = getSimulatedSubscriptionStatus();
      if (simulatedStatus !== null) {
        devLog('Using simulated subscription status:', simulatedStatus);
        const type = simulatedStatus ? 'quarterly' : 'free';
        await saveSubscriptionCache(simulatedStatus, type);
        setIsSubscribed(simulatedStatus);
        setSubscriptionType(type);
        setIsLoading(false);
        return;
      }

      // Check network availability before attempting RevenueCat call
      const hasNetwork = await isNetworkAvailable();

      if (!hasNetwork) {
        devLog('No network available, using cached subscription data');
        const cached = await getSubscriptionCache(true);
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

      // Network available, check real subscription
      const customerInfo = await Purchases.getCustomerInfo();
      const [hasActiveSubscription, type] = await checkEntitlementStatus(customerInfo);
      devLog('Real subscription status:', { hasActiveSubscription, type });

      await saveSubscriptionCache(hasActiveSubscription, type);
      recordConfirmedMembership(hasActiveSubscription, type);
      setIsSubscribed(hasActiveSubscription);
      setSubscriptionType(type);
      setIsLoading(false);
    } catch (error) {
      console.error('Failed to check subscription status:', error);
      // On error, try to get status from cache
      const cached = await getSubscriptionCache(false);
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
  };

  // Initialize subscription status - cache-first, no blocking network check
  useEffect(() => {
    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const initializeStatus = async () => {
      setIsLoading(true);
      try {
        const simulatedStatus = getSimulatedSubscriptionStatus();
        if (simulatedStatus !== null) {
          const type = simulatedStatus ? 'quarterly' : 'free';
          setIsSubscribed(simulatedStatus);
          setSubscriptionType(type);
          setIsLoading(false);
          return;
        }

        const cached = await getSubscriptionCache(false);
        // `cancelled` guarded only the timeout below, so a provider that
        // unmounted (or re-mounted on sign-out) during the SecureStore read
        // still published the old user's entitlement.
        if (cancelled) return;
        if (cached) {
          setIsSubscribed(cached.isSubscribed);
          setSubscriptionType(cached.subscriptionType);
        } else {
          setIsSubscribed(null);
          setSubscriptionType('unknown');
        }

        if (cached?.isExpired) {
          setIsUsingStaleCache(true);
        }
        setIsLoading(false);

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
          // Never log the whole CustomerInfo: it carries the RevenueCat app
          // user id, purchase dates, and store transaction ids.
          devLog('Customer info updated. Active entitlements:', Object.keys(info.entitlements.active));
          setIsLoading(true);
          const [hasActiveSubscription, type] = await checkEntitlementStatus(info);
          devLog('Subscription update received:', { hasActiveSubscription, type });

          await saveSubscriptionCache(hasActiveSubscription, type);
          recordConfirmedMembership(hasActiveSubscription, type);

          setIsSubscribed(hasActiveSubscription);
          setSubscriptionType(type);
          setIsLoading(false);
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
  }, [recordConfirmedMembership]);

  // Listen for network changes and refresh when coming back online
  useEffect(() => {
    const unsubscribe = subscribeToNetworkChanges(async (isConnected) => {
      devLog('Network state changed:', isConnected);

      if (isConnected && isUsingStaleCache) {
        devLog('Network restored and using stale cache, refreshing subscription...');
        await checkSubscriptionStatus();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [isUsingStaleCache]);

  const setSubscribed = async (value: boolean, type: 'free' | 'quarterly' | 'lifetime') => {
    try {
      await saveSubscriptionCache(value, type);
      recordConfirmedMembership(value, type);
      setIsSubscribed(value);
      setSubscriptionType(type);
    } catch (e) {
      console.error('Failed to save subscription status:', e);
    }
  };

  const restorePurchases = async (): Promise<boolean> => {
    try {
      devLog('Attempting to restore purchases...');
      const customerInfo = await Purchases.restorePurchases();
      const [hasActiveSubscription, type] = await checkEntitlementStatus(customerInfo);
      devLog('Restore purchases result:', { hasActiveSubscription, type });
      
      await setSubscribed(hasActiveSubscription, type);
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
        isUsingStaleCache,
        lastSyncTimestamp,
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
