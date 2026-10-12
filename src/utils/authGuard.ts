import { useRouter } from 'expo-router';
import { useUser } from '@clerk/expo';
import { Alert } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import { showToast, type ToastOptions } from '@/lib/toast';
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

export interface AuthGuardInputs {
  /** Clerk's user id, or null when Clerk has no session. */
  userId: string | null;
  /** Whether Clerk has finished resolving the session. */
  isLoaded: boolean;
  /** SecureStore hint: `null` when there is no usable cache entry. */
  cachedIsSignedIn: boolean | null;
  /** `null` until the network probe resolves. */
  hasNetwork: boolean | null;
  /** Whether the cache + network probe effect has resolved at least once. */
  isCacheResolved: boolean;
}

/**
 * Whether the caller is authenticated: `true` to proceed, `false` to prompt
 * for sign-in, `null` while the answer is still unknown.
 *
 * The SecureStore cache is a *hint*, never truth (AGENTS.md: "the client cache
 * is a hint, never a source of truth for writes"). It exists so an offline
 * user, or a user whose Clerk session has not loaded yet, is not bounced to
 * the sign-in sheet. Once Clerk has loaded and told us there is no session,
 * and the device believes it is online, Clerk wins: trusting a cache entry
 * that can be up to seven days old would let a signed-out user — or one whose
 * session was revoked on another device — through the gate and into writes
 * that then have no token.
 *
 * Note the asymmetry this closes: the network probe fails *open* to
 * `hasNetwork === true` in the caller, so a probe that throws now means "we
 * cannot vouch for the cache", not "trust the cache forever".
 */
export function resolveAuthState({
  userId,
  isLoaded,
  cachedIsSignedIn,
  hasNetwork,
  isCacheResolved,
}: AuthGuardInputs): boolean | null {
  if (!isCacheResolved || hasNetwork === null) {
    return null;
  }

  if (userId) return true;

  // Clerk cannot answer yet (still loading) or never will (offline). This is
  // the only window in which the cached hint stands in for a real session.
  const clerkCanAnswer = isLoaded && hasNetwork;
  if (!clerkCanAnswer && cachedIsSignedIn === true) {
    return true;
  }

  if (!isLoaded) {
    return null;
  }

  return false;
}

/**
 * Why {@link resolveAuthState} could not answer. Offline, Clerk never
 * finishes loading, so a user with no cached sign-in stays undecided for as
 * long as the venue has no signal; every gated tap used to return silently.
 */
export type AuthPendingReason = 'offline' | 'loading';

export function authPendingReason(hasNetwork: boolean | null): AuthPendingReason {
  return hasNetwork === false ? 'offline' : 'loading';
}

const AUTH_PENDING_TOASTS: Record<AuthPendingReason, ToastOptions> = {
  offline: { type: 'info', message: "You're offline. Connect to the internet to sign in." },
  loading: { type: 'info', message: 'Still checking your sign-in. Try again in a moment.' },
};

export function authPendingToast(reason: AuthPendingReason): ToastOptions {
  return AUTH_PENDING_TOASTS[reason];
}

// Re-exported: the return-path rule and the deep-link rule are one policy.
export { isInternalRoutePath } from '@/utils/deepLinks';

export type AuthRouteTarget = 'loading' | 'app' | 'auth';

export interface AuthRouteInputs {
  /** Whether the network probe says the device is offline. */
  isOffline: boolean;
  /** Whether the SecureStore read is still in flight. */
  isCacheLoading: boolean;
  /** Whether the SecureStore read threw. */
  hasError: boolean;
  isClerkLoaded: boolean;
  isSignedIn: boolean | undefined;
  cachedIsSignedIn: boolean | null;
}

/**
 * What the `(auth)` layout should render: the auth stack, a redirect into the
 * app, or nothing while the answer is still unknown.
 *
 * Same rule as {@link resolveAuthState}, stated once for the routing layer:
 * the cached hint only stands in for Clerk while Clerk cannot answer. Offline,
 * Clerk never completes its handshake, so the cache is all there is. Online
 * and loaded, Clerk is authoritative — redirecting into the app off a
 * seven-day-old cache put a user whose session had been revoked inside the
 * app, where every authenticated call 401s and the layout kept bouncing them
 * away from the sign-in screen they needed.
 */
export function resolveAuthRouteTarget({
  isOffline,
  isCacheLoading,
  hasError,
  isClerkLoaded,
  isSignedIn,
  cachedIsSignedIn,
}: AuthRouteInputs): AuthRouteTarget {
  if (isOffline && !isCacheLoading) {
    return cachedIsSignedIn === true ? 'app' : 'auth';
  }

  if (!isClerkLoaded || isCacheLoading) return 'loading';
  if (hasError) return 'auth';

  return isSignedIn ? 'app' : 'auth';
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

  const authState = resolveAuthState({
    userId,
    isLoaded,
    cachedIsSignedIn,
    hasNetwork,
    isCacheResolved,
  });

  /** Tell the user why a tap did nothing while sign-in cannot be decided. */
  const notifyAuthPending = useCallback(() => {
    showToast(authPendingToast(authPendingReason(hasNetwork)));
  }, [hasNetwork]);

  /**
   * Check if user is authenticated. If not, show login prompt.
   * @returns true if authenticated, false if login is required, null if it
   * cannot be decided yet (a toast says why: offline, or still loading)
   */
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
    // Same policy as `requireAuth`, so a screen that reads this flag and one
    // that calls the guard can never disagree about the same user. Like the
    // guard, it may trust the cached hint, so it is for reads and navigation
    // only, never a stand-in for a token on a write.
    isAuthenticated: authState === true,
    /** `resolveAuthState`'s answer: `null` while it cannot be decided. */
    authState,
    notifyAuthPending,
    isLoaded,
  };
}
