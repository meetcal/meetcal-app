import { useRouter } from 'expo-router';
import { useUser } from '@clerk/expo';
import { Alert } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import { cacheAuthState, getCachedAuthState } from '@/lib/authCache';
import { isMaestroE2E } from '@/lib/e2e';
import { isNetworkAvailable } from '@/lib/networkUtils';

export interface AuthGuardOptions {
  /** Feature being accessed (for analytics/logging) */
  feature: string;
  /** Custom message to show in alert */
  message?: string;
  /** Where to return after auth completes */
  returnPath?: string;
}

/**
 * Hook to guard features that require authentication.
 * Shows login prompt if user is not authenticated.
 */
export function useAuthGuard() {
  const { user, isLoaded } = useUser();
  const userId = user?.id ?? null;
  const router = useRouter();
  const [cachedIsSignedIn, setCachedIsSignedIn] = useState<boolean | null>(null);
  const [hasNetwork, setHasNetwork] = useState<boolean | null>(null);
  const [isCacheResolved, setIsCacheResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadCachedAuthAndNetwork() {
      const [cachedState, networkAvailable] = await Promise.all([
        getCachedAuthState().catch(() => null),
        isNetworkAvailable().catch(() => true),
      ]);
      if (cancelled) return;
      setCachedIsSignedIn(cachedState?.isSignedIn ?? null);
      setHasNetwork(networkAvailable);
      setIsCacheResolved(true);
    }

    loadCachedAuthAndNetwork();

    return () => {
      cancelled = true;
    };
  }, [userId, isLoaded]);

  useEffect(() => {
    let cancelled = false;

    async function persistResolvedAuthState() {
      if (!isLoaded) return;

      const networkAvailable = await isNetworkAvailable().catch(() => null);
      if (networkAvailable !== true) {
        if (!cancelled && networkAvailable !== null) {
          setHasNetwork(networkAvailable);
        }
        return;
      }

      if (userId) {
        await cacheAuthState(true, userId);
        if (!cancelled) {
          setCachedIsSignedIn(true);
          setHasNetwork(true);
        }
        return;
      }

      await cacheAuthState(false);
      if (!cancelled) {
        setCachedIsSignedIn(false);
        setHasNetwork(true);
      }
    }

    persistResolvedAuthState();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, userId]);

  /**
   * Check if user is authenticated. If not, show login prompt.
   * @returns true if authenticated, false if login is required, null if still loading
   */
  const requireAuth = useCallback((options: AuthGuardOptions): boolean | null => {
    if (isMaestroE2E()) {
      return true;
    }

    if (!isCacheResolved || hasNetwork === null) {
      return null;
    }

    const authenticatedByCache = cachedIsSignedIn === true;
    const authenticatedByClerk = !!userId;

    if (authenticatedByClerk || authenticatedByCache) {
      return true;
    }

    if (!isLoaded) {
      return null;
    }

    const defaultMessage = 'You need to sign in to use this feature.';

    Alert.alert(
      'Sign In Required',
      options.message || defaultMessage,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Sign In',
          onPress: () => {
            router.push({
              pathname: '/(auth)/sign-in',
              params: {
                from: options.returnPath || '/(tabs)',
                feature: options.feature,
              },
            } as any);
          },
        },
      ]
    );

    return false;
  }, [userId, isLoaded, router, cachedIsSignedIn, hasNetwork, isCacheResolved]);

  return {
    requireAuth,
    isAuthenticated: !!userId || cachedIsSignedIn === true,
    isLoaded,
  };
}
