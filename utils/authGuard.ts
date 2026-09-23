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
 * Whether a `from` param is safe to hand to `router.replace`.
 *
 * `from` is a return path threaded through sign-in and the paywall. Callers
 * have not always sent one: the schedule tab's profile button sent the bare
 * string `"info"`, and sign-in's guard tested it against the unrelated literal
 * `"feature"`, so `router.replace("info")` resolved relative to
 * `/(auth)/sign-in` and dropped the user on a route that does not exist
 * instead of where they were going. Require an absolute in-app path, and
 * reject anything that could navigate off-app.
 */
export function isInternalRoutePath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  // `//host` is protocol-relative, not an in-app path.
  return value.startsWith('/') && !value.startsWith('//');
}

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

  /**
   * Check if user is authenticated. If not, show login prompt.
   * @returns true if authenticated, false if login is required, null if still loading
   */
  const requireAuth = useCallback((options: AuthGuardOptions): boolean | null => {
    if (isMaestroE2E()) {
      return true;
    }

    const resolved = resolveAuthState({
      userId,
      isLoaded,
      cachedIsSignedIn,
      hasNetwork,
      isCacheResolved,
    });
    if (resolved !== false) {
      return resolved;
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
  }, [userId, isLoaded, router, cachedIsSignedIn, hasNetwork, isCacheResolved]);

  return {
    requireAuth,
    // Same policy as `requireAuth`, so a screen that reads this flag and one
    // that calls the guard can never disagree about the same user.
    isAuthenticated:
      resolveAuthState({
        userId,
        isLoaded,
        cachedIsSignedIn,
        hasNetwork,
        isCacheResolved,
      }) === true,
    isLoaded,
  };
}
