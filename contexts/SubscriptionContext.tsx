import { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Purchases, { CustomerInfo } from 'react-native-purchases';
import { getSimulatedSubscriptionStatus } from '@/config/development';

type SubscriptionContextType = {
  isSubscribed: boolean | null;
  setSubscribed: (value: boolean) => Promise<void>;
  isLoading: boolean;
  restorePurchases: () => Promise<boolean>;
  checkSubscriptionStatus: () => Promise<void>;
};

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [isSubscribed, setIsSubscribed] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Helper function to check subscription status consistently
  const checkEntitlementStatus = async (customerInfo: CustomerInfo): Promise<boolean> => {
    // Check for simulated subscription first
    const simulatedStatus = getSimulatedSubscriptionStatus();
    if (simulatedStatus !== null) {
      console.log('Using simulated subscription status:', simulatedStatus);
      return simulatedStatus;
    }

    const hasActiveEntitlement = customerInfo.entitlements.active['Subscriptions'] != null;
    console.log('Checking entitlement status:', {
      hasActiveEntitlement,
      activeEntitlements: customerInfo.entitlements.active,
      allEntitlements: customerInfo.entitlements
    });
    return hasActiveEntitlement;
  };

  const checkSubscriptionStatus = async () => {
    try {
      console.log('Checking subscription status...');
      setIsLoading(true);
      
      // Check for simulated subscription first
      const simulatedStatus = getSimulatedSubscriptionStatus();
      if (simulatedStatus !== null) {
        console.log('Using simulated subscription status:', simulatedStatus);
        await AsyncStorage.setItem('subscriptionStatus', simulatedStatus.toString());
        setIsSubscribed(simulatedStatus);
        return;
      }

      // If no simulation, check real subscription
      const customerInfo = await Purchases.getCustomerInfo();
      const hasActiveSubscription = await checkEntitlementStatus(customerInfo);
      console.log('Real subscription status:', hasActiveSubscription);
      
      await AsyncStorage.setItem('subscriptionStatus', hasActiveSubscription.toString());
      setIsSubscribed(hasActiveSubscription);
    } catch (error) {
      console.error('Failed to check subscription status:', error);
      // On error, try to get status from AsyncStorage
      const status = await AsyncStorage.getItem('subscriptionStatus');
      setIsSubscribed(status === 'true');
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
          console.log('Initializing with simulated status:', simulatedStatus);
          setIsSubscribed(simulatedStatus);
          setIsLoading(false);
          return;
        }

        // Then check AsyncStorage
        const storedStatus = await AsyncStorage.getItem('subscriptionStatus');
        if (storedStatus !== null) {
          console.log('Found stored subscription status:', storedStatus);
          setIsSubscribed(storedStatus === 'true');
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
        const listener = (info: CustomerInfo) => {
          console.log('Customer info updated:', info);
          setIsLoading(true);
          checkEntitlementStatus(info).then(hasActiveSubscription => {
            console.log('Subscription update received:', hasActiveSubscription);
            AsyncStorage.setItem('subscriptionStatus', hasActiveSubscription.toString()).then(() => {
              setIsSubscribed(hasActiveSubscription);
              setIsLoading(false);
            });
          });
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

  const setSubscribed = async (value: boolean) => {
    try {
      await AsyncStorage.setItem('subscriptionStatus', value.toString());
      setIsSubscribed(value);
    } catch (e) {
      console.error('Failed to save subscription status:', e);
    }
  };

  const restorePurchases = async (): Promise<boolean> => {
    try {
      console.log('Attempting to restore purchases...');
      const customerInfo = await Purchases.restorePurchases();
      const hasActiveSubscription = await checkEntitlementStatus(customerInfo);
      console.log('Restore purchases result:', hasActiveSubscription);
      
      await setSubscribed(hasActiveSubscription);
      return hasActiveSubscription;
    } catch (error) {
      console.error('Failed to restore purchases:', error);
      return false;
    }
  };

  return (
    <SubscriptionContext.Provider value={{ 
      isSubscribed, 
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