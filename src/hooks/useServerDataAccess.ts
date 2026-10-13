import { useAuth } from '@clerk/expo';
import { useEffect, useRef } from 'react';

import { useSubscription } from '@/contexts/SubscriptionContext';
import { setDataTokenSource } from '@/lib/api/premium-queries';
import { confirmedSubscriptionFor } from '@/lib/confirmed-entitlement';
import { refreshServerEntitlementOnce } from '@/lib/server-entitlement';

/**
 * Lets the server know who is reading premium data: a subscriber's premium
 * reads carry their Clerk token, and a subscription RevenueCat confirms is
 * checked by the server too (`lib/server-entitlement.ts`). Mounted once, at
 * the root.
 *
 * Only a subscriber (as far as the app knows, the cached hint included)
 * sends the token: a query that reads its caller is cached per caller, so a
 * free user's token would only cost the cache that anonymous reads share,
 * and the server would refuse them premium data either way.
 */
export function useServerDataAccess(): void {
  const { isSignedIn, userId, getToken } = useAuth();
  const { isSubscribed, confirmedEntitlement } = useSubscription();
  // Clerk's `getToken` changes identity across renders; the token source
  // reads the current one.
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const sendsToken = isSignedIn === true && isSubscribed === true;
  useEffect(() => {
    if (!sendsToken) {
      setDataTokenSource(null);
      return;
    }
    setDataTokenSource(() => getTokenRef.current());
    return () => setDataTokenSource(null);
  }, [sendsToken, userId]);

  // The dev simulation stands for whoever is signed in; the server would
  // only find out RevenueCat disagrees.
  const subscribed = !confirmedEntitlement?.simulated && confirmedSubscriptionFor(confirmedEntitlement, userId) === true;
  useEffect(() => {
    if (!userId || !subscribed) return;
    void refreshServerEntitlementOnce(userId, () => getTokenRef.current());
  }, [userId, subscribed]);
}
