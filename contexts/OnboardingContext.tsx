import { createContext, useContext, useState } from 'react';
import { storage } from '@/utils/storage';

const HAS_SEEN_SUBSCRIPTION = 'hasSeenSubscription';

type OnboardingContextType = {
  hasSeenSubscription: boolean;
  setHasSeenSubscription: (value: boolean) => void;
};

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [hasSeenSubscription, setHasSeenSubscription] = useState(() => {
    return !!storage.getBoolean(HAS_SEEN_SUBSCRIPTION);
  });

  return (
    <OnboardingContext.Provider value={{ hasSeenSubscription, setHasSeenSubscription }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }
  return context;
} 