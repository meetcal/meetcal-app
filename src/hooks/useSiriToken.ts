import { useAuth } from '@clerk/expo';
import { useEffect, useEffectEvent } from 'react';
import { AppState, Platform } from 'react-native';

import { useSubscription } from '@/contexts/SubscriptionContext';
import { syncSiriToken } from '@/lib/siri-token';

/**
 * Keeps Siri's sign-in token (`lib/siri-token.ts`) in step with who is signed
 * in: a subscriber gets one, a sign-out or a change of user ends it. Checked
 * when Clerk or the subscription changes and whenever the app comes to the
 * foreground, so a token nearing expiry is replaced on an ordinary launch.
 * iOS only: Siri's App Intents are the only reader. Mounted once, at the root.
 */
export function useSiriToken(): void {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const { isSubscribed } = useSubscription();
  const signedInUser = isLoaded && isSignedIn === true ? userId ?? null : null;
  const subscribed = isSubscribed === true;

  const sync = useEffectEvent(() => {
    if (Platform.OS !== 'ios') return;
    void syncSiriToken({ isLoaded, userId: signedInUser, subscribed, getClerkToken: () => getToken() });
  });

  useEffect(() => {
    sync();
  }, [isLoaded, signedInUser, subscribed]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') sync();
    });
    return () => subscription.remove();
  }, []);
}
