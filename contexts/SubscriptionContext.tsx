import { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Purchases, { CustomerInfo } from 'react-native-purchases';
import { getSimulatedSubscriptionStatus } from '@/config/development';
import { supabase } from '@/lib/supabase';
import { useUser } from '@clerk/clerk-expo';

type SubscriptionContextType = {
  isSubscribed: boolean | null;
  subscriptionType: 'free' | 'quarterly' | 'lifetime' | null;
  setSubscribed: (value: boolean, type: 'free' | 'quarterly' | 'lifetime') => Promise<void>;
  isLoading: boolean;
  restorePurchases: () => Promise<boolean>;
  checkSubscriptionStatus: () => Promise<void>;
};

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [isSubscribed, setIsSubscribed] = useState<boolean | null>(null);
  const [subscriptionType, setSubscriptionType] = useState<'free' | 'quarterly' | 'lifetime' | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { user } = useUser();

  // Helper function to sync subscription status with Supabase
  const syncSubscriptionWithSupabase = async (status: boolean, type: 'free' | 'quarterly' | 'lifetime') => {
    if (!user?.id) return;

    try {
      const { error } = await supabase
        .from('users')
        .update({ subscription_status: type })
        .eq('id', user.id);

      if (error) throw error;
    } catch (error) {
      console.error('Failed to sync subscription with Supabase:', error);
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
        await AsyncStorage.setItem('subscriptionStatus', simulatedStatus.toString());
        await AsyncStorage.setItem('subscriptionType', type);
        setIsSubscribed(simulatedStatus);
        setSubscriptionType(type);
        await syncSubscriptionWithSupabase(simulatedStatus, type);
        return;
      }

      // If no simulation, check real subscription
      const customerInfo = await Purchases.getCustomerInfo();
      const [hasActiveSubscription, type] = await checkEntitlementStatus(customerInfo);
      console.log('Real subscription status:', { hasActiveSubscription, type });
      
      await AsyncStorage.setItem('subscriptionStatus', hasActiveSubscription.toString());
      await AsyncStorage.setItem('subscriptionType', type);
      setIsSubscribed(hasActiveSubscription);
      setSubscriptionType(type);
      await syncSubscriptionWithSupabase(hasActiveSubscription, type);
    } catch (error) {
      console.error('Failed to check subscription status:', error);
      // On error, try to get status from AsyncStorage
      const status = await AsyncStorage.getItem('subscriptionStatus');
      const type = await AsyncStorage.getItem('subscriptionType') as 'free' | 'quarterly' | 'lifetime' | null;
      setIsSubscribed(status === 'true');
      setSubscriptionType(type || 'free');
    } finally {
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
          await syncSubscriptionWithSupabase(simulatedStatus, type);
          setIsLoading(false);
          return;
        }

        // Then check AsyncStorage
        const storedStatus = await AsyncStorage.getItem('subscriptionStatus');
        const storedType = await AsyncStorage.getItem('subscriptionType') as 'free' | 'quarterly' | 'lifetime' | null;
        if (storedStatus !== null) {
          console.log('Found stored subscription status:', { storedStatus, storedType });
          setIsSubscribed(storedStatus === 'true');
          setSubscriptionType(storedType || 'free');
        }
        
        // Finally check live status
        await checkSubscriptionStatus();
      } catch (error) {
        console.error('Failed to initialize subscription status:', error);
        setIsLoading(false);
      }
    };

    initializeStatus();
  }, []);

  useEffect(() => {
    let customerInfoUpdateListener: (() => void) | undefined;

    const setupListener = async () => {
      try {
        const listener = async (info: CustomerInfo) => {
          console.log('Customer info updated:', info);
          setIsLoading(true);
          const [hasActiveSubscription, type] = await checkEntitlementStatus(info);
          console.log('Subscription update received:', { hasActiveSubscription, type });
          
          await AsyncStorage.setItem('subscriptionStatus', hasActiveSubscription.toString());
          await AsyncStorage.setItem('subscriptionType', type);
          await syncSubscriptionWithSupabase(hasActiveSubscription, type);
          
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

  const setSubscribed = async (value: boolean, type: 'free' | 'quarterly' | 'lifetime') => {
    try {
      await AsyncStorage.setItem('subscriptionStatus', value.toString());
      await AsyncStorage.setItem('subscriptionType', type);
      setIsSubscribed(value);
      setSubscriptionType(type);
      await syncSubscriptionWithSupabase(value, type);
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
      checkSubscriptionStatus
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