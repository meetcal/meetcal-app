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

  const checkSubscriptionStatus = async () => {
    try {
      const customerInfo = await Purchases.getCustomerInfo();
      const hasActiveSubscription = customerInfo.entitlements.active['pro_features'] != null;
      
      await AsyncStorage.setItem('subscriptionStatus', hasActiveSubscription.toString());
      setIsSubscribed(hasActiveSubscription);
    } catch (error) {
      console.error('Failed to check subscription status:', error);
      // Fall back to stored value if RevenueCat check fails
      const status = await AsyncStorage.getItem('subscriptionStatus');
      setIsSubscribed(status === 'true');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkSubscriptionStatus();
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
      const customerInfo = await Purchases.restorePurchases();
      const hasActiveSubscription = customerInfo.entitlements.active['pro_features'] != null;
      
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