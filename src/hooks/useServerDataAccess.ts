import { useAuth } from '@clerk/expo';
import { useEffect, useRef } from 'react';

import { useSubscription } from '@/contexts/SubscriptionContext';
import { prefetchAccessPass, setAccessPassSource } from '@/lib/api/premium-queries';
import { loadAccessPass } from '@/lib/access-pass';

/**
 * Gives a subscriber's premium reads the shared access pass
 * (`lib/api/premium-queries.ts`), fetched as soon as the app believes they
 * subscribe (the cached hint included), so the first premium read does not
 * wait for it. Mounted once, at the root.
 */
export function useServerDataAccess(): void {
  const { isSignedIn, userId, getToken } = useAuth();
  const { isSubscribed } = useSubscription();
  // Clerk's `getToken` changes identity across renders; the source reads the
  // current one.
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const holdsPass = isSignedIn === true && isSubscribed === true;
  useEffect(() => {
    if (!holdsPass) {
      setAccessPassSource(null);
      return;
    }
    setAccessPassSource(() => loadAccessPass(() => getTokenRef.current()));
    prefetchAccessPass();
    return () => setAccessPassSource(null);
  }, [holdsPass, userId]);
}
