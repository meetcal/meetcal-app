import { useEffect, useState } from 'react';
import { getCachedAuthState } from '@/lib/authCache';

/**
 * The user whose saved sessions are on screen before Clerk has loaded:
 * Clerk's id when it has one, else the signed-in id from the SecureStore
 * auth hint (read-only trust; writes still need Clerk). `hasResolvedUser`
 * turns true once that decision has been made at least once.
 */
export function useStorageUser(clerkUserId: string | undefined): {
  storageUserId: string | null;
  hasResolvedUser: boolean;
} {
  const [storageUserId, setStorageUserId] = useState<string | null>(null);
  const [hasResolvedUser, setHasResolvedUser] = useState(false);

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

      const cachedAuthState = await getCachedAuthState().catch(() => null);
      if (cancelled) return;

      if (cachedAuthState?.isSignedIn && cachedAuthState.userId) {
        setStorageUserId(cachedAuthState.userId);
      } else {
        setStorageUserId(null);
      }
      setHasResolvedUser(true);
    };

    resolveUser();
    return () => {
      cancelled = true;
    };
  }, [clerkUserId]);

  return { storageUserId, hasResolvedUser };
}
