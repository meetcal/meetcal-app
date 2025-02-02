import { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
      const status = await AsyncStorage.getItem('subscriptionStatus');
      setIsSubscribed(status === 'true');
    } catch (e) {
      console.error('Failed to get subscription status:', e);
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