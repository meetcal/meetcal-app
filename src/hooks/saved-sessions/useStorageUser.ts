import { useEffect, useState } from 'react';
import { getCachedAuthState } from '@/lib/authCache';
import { isNetworkAvailable, subscribeToNetworkChanges } from '@/lib/networkUtils';
import { resolveStorageUserId } from '@/lib/saved-sessions-user';

/**
 * The user whose saved sessions are on screen: Clerk's id when it has one,
 * else the signed-in id from the SecureStore auth hint while Clerk cannot
 * answer (read-only trust; writes still need Clerk). Once Clerk has loaded
 * with no user and the device is online, no one (see
 * `resolveStorageUserId`). `hasResolvedUser` turns true once that decision
 * has been made at least once.
 */
export function useStorageUser(
  clerkUserId: string | undefined,
  isClerkLoaded: boolean,
): {
  storageUserId: string | null;
  hasResolvedUser: boolean;
} {
  const [storageUserId, setStorageUserId] = useState<string | null>(null);
  const [hasResolvedUser, setHasResolvedUser] = useState(false);
  // Bumped when the device comes back online, so a cached user kept only
  // because the device was offline is re-checked against Clerk.
  const [onlineEpoch, setOnlineEpoch] = useState(0);

  useEffect(() => {
    if (clerkUserId || !isClerkLoaded) return;
    let lastConnected: boolean | null = null;
    return subscribeToNetworkChanges((isConnected) => {
      const previous = lastConnected;
      lastConnected = isConnected;
      if (isConnected && previous === false) setOnlineEpoch((epoch) => epoch + 1);
    });
  }, [clerkUserId, isClerkLoaded]);

  useEffect(() => {
    let cancelled = false;

    const resolveUser = async () => {
      if (clerkUserId) {
        if (!cancelled) {
          setStorageUserId(clerkUserId);
          setHasResolvedUser(true);
        }
        return;
      }

      const [cachedAuthState, hasNetwork] = await Promise.all([
        getCachedAuthState().catch(() => null),
        // Only asked once Clerk can answer. A failed probe counts as online,
        // as in `useAuthGuard`: it cannot vouch for the cached hint.
        isClerkLoaded ? isNetworkAvailable().catch(() => true) : Promise.resolve(false),
      ]);
      if (cancelled) return;

      setStorageUserId(
        resolveStorageUserId({
          clerkUserId,
          isClerkLoaded,
          hasNetwork,
          cachedUserId:
            cachedAuthState?.isSignedIn && cachedAuthState.userId
              ? cachedAuthState.userId
              : null,
        }),
      );
      setHasResolvedUser(true);
    };

    resolveUser();
    return () => {
      cancelled = true;
    };
  }, [clerkUserId, isClerkLoaded, onlineEpoch]);

  return { storageUserId, hasResolvedUser };
}
