import { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Purchases, { CustomerInfo } from 'react-native-purchases';
import { getSimulatedSubscriptionStatus } from '@/config/development';
import { useUser } from '@clerk/clerk-expo';

type SubscriptionContextType = {
  isSubscribed: boolean | null;
  subscriptionType: 'free' | 'premium' | 'weekpass' | null;
  setSubscribed: (value: boolean, type: 'free' | 'premium' | 'weekpass') => Promise<void>;
  isLoading: boolean;
  restorePurchases: () => Promise<boolean>;
  checkSubscriptionStatus: () => Promise<void>;
};

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [isSubscribed, setIsSubscribed] = useState<boolean | null>(null);
  const [subscriptionType, setSubscriptionType] = useState<'free' | 'premium' | 'weekpass' | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { user } = useUser();

  // Helper function to check subscription status consistently
  const checkEntitlementStatus = async (customerInfo: CustomerInfo): Promise<[boolean, 'free' | 'premium' | 'weekpass']> => {
    // Check for simulated subscription first
    const simulatedSubscriptionType = getSimulatedSubscriptionStatus();
    if (simulatedSubscriptionType !== null) {
      console.log('Using simulated subscription status:', simulatedSubscriptionType);
      const isActive = simulatedSubscriptionType !== 'free';
      return [isActive, simulatedSubscriptionType];
    }

    let hasActiveAccess = false;
    let determinedSubscriptionType: 'free' | 'premium' | 'weekpass' = 'free';

    const activeSubscriptionEntitlement = customerInfo.entitlements.active['Subscriptions'];

    if (activeSubscriptionEntitlement && activeSubscriptionEntitlement.isActive) {
      const productIdentifier = activeSubscriptionEntitlement.productIdentifier;
      const purchaseDateStr = activeSubscriptionEntitlement.latestPurchaseDate;

      if (productIdentifier === 'week_pass_meetcal') {
        if (purchaseDateStr) {
          try {
            const purchaseDate = new Date(purchaseDateStr);
            const expiryDate = new Date(purchaseDate.getTime());
            expiryDate.setUTCDate(purchaseDate.getUTCDate() + 7);
            const currentDate = new Date();

            if (currentDate.getTime() <= expiryDate.getTime()) {
              hasActiveAccess = true;
              determinedSubscriptionType = 'weekpass';
            } else {
              // Week pass expired
              hasActiveAccess = false;
              determinedSubscriptionType = 'free'; 
              console.log(
                'Week pass has expired (UTC comparison). Purchase date (UTC):',
                purchaseDate.toISOString(), 
                'Expiry (UTC):', 
                expiryDate.toISOString()
              );
            }
          } catch (e) {
            console.error('Error processing week_pass_meetcal purchase date (UTC):', e);
            // Treat as no access if date parsing fails
            hasActiveAccess = false;
            determinedSubscriptionType = 'free';
          }
        } else {
          // No purchase date for week_pass_meetcal, should not happen if product is active
          console.warn('week_pass_meetcal is active product but has no purchase date.');
          hasActiveAccess = false; // Or true, depending on desired fallback for this edge case
          determinedSubscriptionType = 'free';
        }
      } else if (productIdentifier) { 
        // Any other active product under 'Subscriptions' grants premium access
        hasActiveAccess = true;
        determinedSubscriptionType = 'premium'; 
      } else {
        // Entitlement 'Subscriptions' is active but no productIdentifier?
        // This is unusual. Could be a new product not yet handled or a glitch.
        // Defaulting to some access, but this should be reviewed.
        console.warn('Active "Subscriptions" entitlement has no productIdentifier.');
        hasActiveAccess = true; 
        determinedSubscriptionType = 'premium'; // Fallback type
      }
    } else {
      // No active 'Subscriptions' entitlement
      hasActiveAccess = false;
      determinedSubscriptionType = 'free';
    }

    console.log('Checking entitlement status:', {
      hasActiveAccess,
      subscriptionType: determinedSubscriptionType,
      productIdentifier: activeSubscriptionEntitlement?.productIdentifier,
      purchaseDate: activeSubscriptionEntitlement?.latestPurchaseDate,
      activeEntitlements: customerInfo.entitlements.active,
    });
    
    return [hasActiveAccess, determinedSubscriptionType];
  };

  const checkSubscriptionStatus = async () => {
    try {
      console.log('Checking subscription status...');
      setIsLoading(true);
      
      // Check for simulated subscription first
      const simulatedSubscriptionType = getSimulatedSubscriptionStatus();
      if (simulatedSubscriptionType !== null) {
        console.log('Using simulated subscription status:', simulatedSubscriptionType);
        const isActive = simulatedSubscriptionType !== 'free';
        await AsyncStorage.setItem('subscriptionStatus', isActive.toString());
        await AsyncStorage.setItem('subscriptionType', simulatedSubscriptionType);
        setIsSubscribed(isActive);
        setSubscriptionType(simulatedSubscriptionType);
        setIsLoading(false);
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
      setIsLoading(false);
    } catch (error) {
      console.error('Failed to check subscription status:', error);
      // On error, try to get status from AsyncStorage
      const status = await AsyncStorage.getItem('subscriptionStatus');
      const type = await AsyncStorage.getItem('subscriptionType') as 'free' | 'premium' | 'weekpass' | null;
      setIsSubscribed(status === 'true');
      setSubscriptionType(type || 'free');
      setIsLoading(false);
    }
  };

  // Initialize subscription status
  useEffect(() => {
    const initializeStatus = async () => {
      setIsLoading(true);
      try {
        // First check if we have a simulated status
        const simulatedSubscriptionType = getSimulatedSubscriptionStatus();
        if (simulatedSubscriptionType !== null) {
          const isActive = simulatedSubscriptionType !== 'free';
          console.log('Initializing with simulated status:', { simulatedSubscriptionType });
          setIsSubscribed(isActive);
          setSubscriptionType(simulatedSubscriptionType);
          setIsLoading(false);
          return;
        }

        // Then check AsyncStorage
        const storedStatus = await AsyncStorage.getItem('subscriptionStatus');
        const storedType = await AsyncStorage.getItem('subscriptionType') as 'free' | 'premium' | 'weekpass' | null;
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

  const setSubscribed = async (value: boolean, type: 'free' | 'premium' | 'weekpass') => {
    try {
      await AsyncStorage.setItem('subscriptionStatus', value.toString());
      await AsyncStorage.setItem('subscriptionType', type);
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