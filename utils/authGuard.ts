import { useRouter } from 'expo-router';
import { useUser } from '@clerk/clerk-expo';
import { Alert } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import { getCachedAuthState } from '@/lib/authCache';
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
  const router = useRouter();
  const [cachedIsSignedIn, setCachedIsSignedIn] = useState<boolean | null>(null);
  const [hasNetwork, setHasNetwork] = useState<boolean | null>(null);

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
    }

    loadCachedAuthAndNetwork();

    return () => {
      cancelled = true;
    };
  }, [user?.id, isLoaded]);

  /**
   * Check if user is authenticated. If not, show login prompt.
   * @returns true if authenticated, false if login is required, null if still loading
   */
  const requireAuth = useCallback((options: AuthGuardOptions): boolean | null => {
    const authenticatedByCache = cachedIsSignedIn === true;
    const authenticatedByClerk = !!user;
    const isOffline = hasNetwork === false;

    if (authenticatedByClerk || authenticatedByCache) {
      return true;
    }

    if (!isLoaded) {
      if (isOffline && authenticatedByCache) {
        return true;
      }
      if (cachedIsSignedIn === null || hasNetwork === null) {
        return null;
      }
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
  }, [user, isLoaded, router, cachedIsSignedIn, hasNetwork]);

  return {
    requireAuth,
    isAuthenticated: !!user || cachedIsSignedIn === true,
    isLoaded,
  };
}
