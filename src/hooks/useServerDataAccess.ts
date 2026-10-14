import { useAuth } from '@clerk/expo';
import { useEffect, useRef, useState } from 'react';

import { useSubscription } from '@/contexts/SubscriptionContext';
import { prefetchAccessPass, setAccessPassSource } from '@/lib/api/premium-queries';
import { loadAccessPass } from '@/lib/access-pass';
import { getCachedAuthState } from '@/lib/authCache';

/** A promise and its resolver: Clerk having loaded. */
function clerkLoaded() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * Gives a subscriber's premium reads the shared access pass
 * (`lib/api/premium-queries.ts`), fetched as soon as the app believes they
 * subscribe (the cached hint included), so the first premium read does not
 * wait for it. Mounted once, at the root.
 *
 * On a cold start Clerk is still loading when the first screens read. While
 * the SecureStore auth hint says someone is signed in, the pass source waits
 * for Clerk (each read waits at most `ACCESS_PASS_TIMEOUT_MS` for it) rather
 * than letting those reads go without a pass, which the server will refuse
 * once it enforces the subscription.
 */
export function useServerDataAccess(): void {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const { isSubscribed } = useSubscription();
  // Clerk's `getToken` changes identity across renders; the source reads the
  // current one.
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const loadedRef = useRef(clerkLoaded());
  const [hintUserId, setHintUserId] = useState<string | null>(null);

  useEffect(() => {
    if (isLoaded) {
      loadedRef.current.resolve();
      return;
    }
    let cancelled = false;
    void getCachedAuthState()
      .then((state) => {
        if (!cancelled) setHintUserId(state?.isSignedIn && state.userId ? state.userId : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isLoaded]);

  // The user the pass is for: Clerk's once loaded, the hint's until then.
  const passUserId = isLoaded ? (isSignedIn === true ? userId ?? null : null) : hintUserId;
  const holdsPass = isSubscribed === true && passUserId !== null;
  useEffect(() => {
    if (!holdsPass) {
      setAccessPassSource(null);
      return;
    }
    setAccessPassSource(async () => {
      await loadedRef.current.promise;
      return loadAccessPass(() => getTokenRef.current());
    });
    prefetchAccessPass();
    return () => setAccessPassSource(null);
  }, [holdsPass, passUserId]);
}
