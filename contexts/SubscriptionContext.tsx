import { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Purchases, { CustomerInfo } from 'react-native-purchases';
import { getSimulatedSubscriptionStatus } from '@/config/development';
import { useUser } from '@clerk/clerk-expo';
import { isNetworkAvailable, subscribeToNetworkChanges } from '@/lib/networkUtils';

type SubscriptionContextType = {
  isSubscribed: boolean | null;
  subscriptionType: 'free' | 'quarterly' | 'lifetime' | null;
  setSubscribed: (value: boolean, type: 'free' | 'quarterly' | 'lifetime') => Promise<void>;
  isLoading: boolean;
  restorePurchases: () => Promise<boolean>;
  checkSubscriptionStatus: () => Promise<void>;
  isUsingStaleCache: boolean;
  lastSyncTimestamp: number | null;
};

interface SubscriptionCacheData {
  isSubscribed: boolean;
  subscriptionType: 'free' | 'quarterly' | 'lifetime';
  timestamp: number;
}

const SUBSCRIPTION_CACHE_KEY = 'subscription_cache_v2';
const SUBSCRIPTION_CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [isSubscribed, setIsSubscribed] = useState<boolean | null>(null);
  const [subscriptionType, setSubscriptionType] = useState<'free' | 'quarterly' | 'lifetime' | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUsingStaleCache, setIsUsingStaleCache] = useState(false);
  const [lastSyncTimestamp, setLastSyncTimestamp] = useState<number | null>(null);
  const { user } = useUser();

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
      console.log('Subscription cache saved:', cacheData);
    } catch (error) {
      console.error('Error saving subscription cache:', error);
    }
  };

  // Helper function to get subscription from cache
  const getSubscriptionCache = async (): Promise<SubscriptionCacheData | null> => {
    try {
      const cached = await AsyncStorage.getItem(SUBSCRIPTION_CACHE_KEY);
      if (!cached) return null;

      const parsed: SubscriptionCacheData = JSON.parse(cached);
      const now = Date.now();
      const isExpired = now - parsed.timestamp > SUBSCRIPTION_CACHE_EXPIRY_MS;

      if (isExpired) {
        console.log('Subscription cache expired (older than 7 days)');
        const hasNetwork = await isNetworkAvailable();

        if (hasNetwork) {
          // Network available, will fetch fresh data
          await AsyncStorage.removeItem(SUBSCRIPTION_CACHE_KEY);
          return null;
        } else {
          // Network unavailable, use stale cache
          console.warn('Using stale subscription cache due to network unavailability');
          setIsUsingStaleCache(true);
          setLastSyncTimestamp(parsed.timestamp);
          return parsed;
        }
      }

      setLastSyncTimestamp(parsed.timestamp);
      setIsUsingStaleCache(false);
      return parsed;
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
      console.log('Using simulated subscription status:', simulatedStatus);
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

    console.log('Checking entitlement status:', {
      hasActiveEntitlement,
      subscriptionType,
      activeEntitlements: customerInfo.entitlements.active,
      allEntitlements: customerInfo.entitlements
    });
    
    return [hasActiveEntitlement, subscriptionType];
  };

  const checkSubscriptionStatus = async () => {
    try {
      console.log('Checking subscription status...');
      setIsLoading(true);

      // Check for simulated subscription first
      const simulatedStatus = getSimulatedSubscriptionStatus();
      if (simulatedStatus !== null) {
        console.log('Using simulated subscription status:', simulatedStatus);
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
        console.log('No network available, using cached subscription data');
        const cached = await getSubscriptionCache();
        if (cached) {
          setIsSubscribed(cached.isSubscribed);
          setSubscriptionType(cached.subscriptionType);
        } else {
          console.warn('No network and no cache available, defaulting to free');
          setIsSubscribed(false);
          setSubscriptionType('free');
        }
        setIsLoading(false);
        return;
      }

      // Network available, check real subscription
      const customerInfo = await Purchases.getCustomerInfo();
      const [hasActiveSubscription, type] = await checkEntitlementStatus(customerInfo);
      console.log('Real subscription status:', { hasActiveSubscription, type });

      await saveSubscriptionCache(hasActiveSubscription, type);
      setIsSubscribed(hasActiveSubscription);
      setSubscriptionType(type);
      setIsLoading(false);
    } catch (error) {
      console.error('Failed to check subscription status:', error);
      // On error, try to get status from cache
      const cached = await getSubscriptionCache();
      if (cached) {
        setIsSubscribed(cached.isSubscribed);
        setSubscriptionType(cached.subscriptionType);
      } else {
        setIsSubscribed(false);
        setSubscriptionType('free');
      }
      setIsLoading(false);
    }
  };

  // Initialize subscription status
  useEffect(() => {
    const initializeStatus = async () => {
      setIsLoading(true);
      try {
        // First check if we have a simulated status
        const simulatedStatus = getSimulatedSubscriptionStatus();
        if (simulatedStatus !== null) {
          const type = simulatedStatus ? 'quarterly' : 'free';
          console.log('Initializing with simulated status:', { simulatedStatus, type });
          setIsSubscribed(simulatedStatus);
          setSubscriptionType(type);
          setIsLoading(false);
          return;
        }

        // Check network availability
        const hasNetwork = await isNetworkAvailable();

        // Load from cache first for instant UI
        const cached = await getSubscriptionCache();
        if (cached) {
          console.log('Initializing with cached subscription:', cached);
          setIsSubscribed(cached.isSubscribed);
          setSubscriptionType(cached.subscriptionType);
        }

        if (hasNetwork) {
          // Network available, fetch fresh data
          console.log('Network available, checking live subscription status');
          await checkSubscriptionStatus();
        } else {
          // No network, use cache only
          console.log('No network, using cached subscription only');
          if (!cached) {
            console.warn('No network and no cache, defaulting to free');
            setIsSubscribed(false);
            setSubscriptionType('free');
          }
          setIsLoading(false);
        }
      } catch (error) {
        console.error('Failed to initialize subscription status:', error);
        setIsLoading(false);
      }
    };

    initializeStatus();
  }, []);

  // Listen for RevenueCat updates
  useEffect(() => {
    let customerInfoUpdateListener: (() => void) | undefined;

    const setupListener = async () => {
      try {
        const listener = async (info: CustomerInfo) => {
          console.log('Customer info updated:', info);
          setIsLoading(true);
          const [hasActiveSubscription, type] = await checkEntitlementStatus(info);
          console.log('Subscription update received:', { hasActiveSubscription, type });

          await saveSubscriptionCache(hasActiveSubscription, type);

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
  }, []);

  // Listen for network changes and refresh when coming back online
  useEffect(() => {
    const unsubscribe = subscribeToNetworkChanges(async (isConnected) => {
      console.log('Network state changed:', isConnected);

      if (isConnected && isUsingStaleCache) {
        console.log('Network restored and using stale cache, refreshing subscription...');
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
      setIsSubscribed(value);
      setSubscriptionType(type);
    } catch (e) {
      console.error('Failed to save subscription status:', e);
    }
  };

  const restorePurchases = async (): Promise<boolean> => {
    try {
      console.log('Attempting to restore purchases...');
      const customerInfo = await Purchases.restorePurchases();
      const [hasActiveSubscription, type] = await checkEntitlementStatus(customerInfo);
      console.log('Restore purchases result:', { hasActiveSubscription, type });
      
      await setSubscribed(hasActiveSubscription, type);
      return hasActiveSubscription;
    } catch (error) {
      console.error('Failed to restore purchases:', error);
      return false;
    }
  };

  return (
    <SubscriptionContext.Provider value={{
      isSubscribed,
      subscriptionType,
      setSubscribed,
      isLoading,
      restorePurchases,
      checkSubscriptionStatus,
      isUsingStaleCache,
      lastSyncTimestamp,
    }}>
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