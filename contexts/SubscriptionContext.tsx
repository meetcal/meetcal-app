import { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Purchases from 'react-native-purchases';

type SubscriptionContextType = {
  isSubscribed: boolean | null;
  setSubscribed: (value: boolean) => Promise<void>;
  isLoading: boolean;
  restorePurchases: () => Promise<boolean>;
};

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [isSubscribed, setIsSubscribed] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Helper function to check subscription status consistently
  const checkEntitlementStatus = async (customerInfo: Purchases.CustomerInfo): Promise<boolean> => {
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
      // Wait longer for RevenueCat initialization
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log('Fetching customer info...');
      const customerInfo = await Purchases.getCustomerInfo();
      console.log('Raw customer info:', customerInfo);
      
      const hasActiveSubscription = await checkEntitlementStatus(customerInfo);
      console.log('Final subscription status:', hasActiveSubscription);
      
      await AsyncStorage.setItem('subscriptionStatus', hasActiveSubscription.toString());
      setIsSubscribed(hasActiveSubscription);
    } catch (error) {
      console.error('Failed to check subscription status:', error);
      const status = await AsyncStorage.getItem('subscriptionStatus');
      setIsSubscribed(status === 'true');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const customerInfoUpdateListener = Purchases.addCustomerInfoUpdateListener(async (info) => {
      console.log('Customer info updated:', info);
      const hasActiveSubscription = await checkEntitlementStatus(info);
      console.log('Subscription update received:', hasActiveSubscription);
      await AsyncStorage.setItem('subscriptionStatus', hasActiveSubscription.toString());
      setIsSubscribed(hasActiveSubscription);
    });

    // Initial check
    checkSubscriptionStatus();

    return () => {
      customerInfoUpdateListener.remove();
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
      restorePurchases 
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