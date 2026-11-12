import { useUser } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { cacheAuthState, getCachedAuthState } from '@/lib/authCache';
import { isMaestroE2E } from '@/lib/e2e';
import { isNetworkAvailable } from '@/lib/networkUtils';
import { showToast } from '@/lib/toast';
import {
  authPendingReason,
  authPendingToast,
  resolveAuthState,
  type AuthGuardOptions,
} from '@/utils/authGuard';

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

    void loadCachedAuthAndNetwork();

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

    void persistResolvedAuthState();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, userId]);

  const authState = resolveAuthState({
    userId,
    isLoaded,
    cachedIsSignedIn,
    hasNetwork,
    isCacheResolved,
  });

  const notifyAuthPending = useCallback(() => {
    showToast(authPendingToast(authPendingReason(hasNetwork)));
  }, [hasNetwork]);

  const requireAuth = useCallback((options: AuthGuardOptions): boolean | null => {
    if (isMaestroE2E()) {
      return true;
    }

    if (authState === true) return true;
    if (authState === null) {
      notifyAuthPending();
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
            });
          },
        },
      ]
    );

    return false;
  }, [authState, notifyAuthPending, router]);

  return {
    requireAuth,
    isAuthenticated: authState === true,
    authState,
    notifyAuthPending,
    isLoaded,
  };
}
