import { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as InAppPurchases from 'expo-in-app-purchases';

type SubscriptionContextType = {
  isSubscribed: boolean | null;
  setSubscribed: (value: boolean) => Promise<void>;
  isLoading: boolean;
};

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [isSubscribed, setIsSubscribed] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkSubscriptionStatus();
  }, []);

  const checkSubscriptionStatus = async () => {
    try {
      // First check local storage
      const status = await AsyncStorage.getItem('subscriptionStatus');
      
      // Verify with StoreKit
      if (status === 'true') {
        try {
          await InAppPurchases.connectAsync();
          const history = await InAppPurchases.getPurchaseHistoryAsync();
          
          // Check for any valid subscription purchase
          const hasActiveSubscription = history.some(purchase => 
            (purchase.productId === 'quarterly_meetcal' || 
             purchase.productId === 'yearly_meetcal')
          );

          setIsSubscribed(hasActiveSubscription);
          
          // Update storage if verification fails
          if (!hasActiveSubscription) {
            await AsyncStorage.setItem('subscriptionStatus', 'false');
          }
        } catch (e) {
          console.error('Failed to verify subscription:', e);
          // Fall back to stored value if StoreKit verification fails
          setIsSubscribed(true);
        }
      } else {
        setIsSubscribed(false);
      }
    } catch (e) {
      console.error('Failed to get subscription status:', e);
      setIsSubscribed(false);
    } finally {
      setIsLoading(false);
    }
  };

  const setSubscribed = async (value: boolean) => {
    try {
      await AsyncStorage.setItem('subscriptionStatus', value.toString());
      setIsSubscribed(value);
    } catch (e) {
      console.error('Failed to save subscription status:', e);
    }
  };

  return (
    <SubscriptionContext.Provider value={{ isSubscribed, setSubscribed, isLoading }}>
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