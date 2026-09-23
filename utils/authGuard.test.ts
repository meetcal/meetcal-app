import {
  isInternalRoutePath,
  resolveAuthRouteTarget,
  resolveAuthState,
  type AuthGuardInputs,
} from '@/utils/authGuard';

// These tests exercise pure policy. Loading the real Clerk SDK starts a
// MessageChannel that keeps Jest workers alive after the suite finishes.
jest.mock('@clerk/expo', () => ({ useUser: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

function inputs(overrides: Partial<AuthGuardInputs> = {}): AuthGuardInputs {
  return {
    userId: null,
    isLoaded: true,
    cachedIsSignedIn: null,
    hasNetwork: true,
    isCacheResolved: true,
    ...overrides,
  };
}

describe('resolveAuthState', () => {
  it('is undecided until the cache and network probe resolve', () => {
    expect(resolveAuthState(inputs({ isCacheResolved: false }))).toBeNull();
    expect(resolveAuthState(inputs({ hasNetwork: null }))).toBeNull();
  });

  it('lets a live Clerk session through', () => {
    expect(resolveAuthState(inputs({ userId: 'user_1' }))).toBe(true);
    expect(
      resolveAuthState(inputs({ userId: 'user_1', isLoaded: false })),
    ).toBe(true);
  });

  it('trusts the cached hint while Clerk is still loading', () => {
    expect(
      resolveAuthState(inputs({ isLoaded: false, cachedIsSignedIn: true })),
    ).toBe(true);
  });

  it('trusts the cached hint offline, where Clerk can never answer', () => {
    expect(
      resolveAuthState(inputs({ hasNetwork: false, cachedIsSignedIn: true })),
    ).toBe(true);
  });

  it('does NOT trust the cached hint once Clerk has loaded and is online', () => {
    // The user signed out on another device, or their session was revoked.
    // Clerk says "no session" and we have the network to prove it, so a
    // 7-day-old "signed in" hint must not open the gate.
    expect(
      resolveAuthState(
        inputs({ isLoaded: true, hasNetwork: true, cachedIsSignedIn: true }),
      ),
    ).toBe(false);
  });

  it('does not trust the hint when the network probe threw and defaulted open', () => {
    // `isNetworkAvailable().catch(() => true)` means a failed probe reports
    // "online"; that has to fail closed, not authenticate off a stale cache.
    expect(
      resolveAuthState(
        inputs({ hasNetwork: true, cachedIsSignedIn: true, userId: null }),
      ),
    ).toBe(false);
  });

  it('stays undecided while Clerk loads with no usable cache', () => {
    expect(
      resolveAuthState(inputs({ isLoaded: false, cachedIsSignedIn: null })),
    ).toBeNull();
    expect(
      resolveAuthState(inputs({ isLoaded: false, cachedIsSignedIn: false })),
    ).toBeNull();
  });

  it('prompts a signed-out user with no cache', () => {
    expect(resolveAuthState(inputs())).toBe(false);
    expect(resolveAuthState(inputs({ cachedIsSignedIn: false }))).toBe(false);
  });

  it('prompts offline when the cache says signed out', () => {
    expect(
      resolveAuthState(inputs({ hasNetwork: false, cachedIsSignedIn: false })),
    ).toBe(false);
  });
});

function routeInputs(
  overrides: Partial<Parameters<typeof resolveAuthRouteTarget>[0]> = {},
): Parameters<typeof resolveAuthRouteTarget>[0] {
  return {
    isOffline: false,
    isCacheLoading: false,
    hasError: false,
    isClerkLoaded: true,
    isSignedIn: false,
    cachedIsSignedIn: null,
    ...overrides,
  };
}

describe('resolveAuthRouteTarget', () => {
  it('waits while Clerk or the cache is still resolving', () => {
    expect(resolveAuthRouteTarget(routeInputs({ isClerkLoaded: false }))).toBe(
      'loading',
    );
    expect(resolveAuthRouteTarget(routeInputs({ isCacheLoading: true }))).toBe(
      'loading',
    );
  });

  it('uses the cache offline, where Clerk never finishes loading', () => {
    expect(
      resolveAuthRouteTarget(
        routeInputs({
          isOffline: true,
          isClerkLoaded: false,
          cachedIsSignedIn: true,
        }),
      ),
    ).toBe('app');
    expect(
      resolveAuthRouteTarget(
        routeInputs({
          isOffline: true,
          isClerkLoaded: false,
          cachedIsSignedIn: false,
        }),
      ),
    ).toBe('auth');
  });

  it('shows the auth stack when Clerk is loaded, online, and signed out', () => {
    // Regression: a revoked session plus a still-valid cache used to redirect
    // straight into the app, where every authenticated call 401s and this very
    // layout bounced the user off the sign-in screen they needed.
    expect(
      resolveAuthRouteTarget(
        routeInputs({ isSignedIn: false, cachedIsSignedIn: true }),
      ),
    ).toBe('auth');
  });

  it('redirects a live Clerk session into the app', () => {
    expect(resolveAuthRouteTarget(routeInputs({ isSignedIn: true }))).toBe(
      'app',
    );
  });

  it('shows the auth stack when the cache read threw', () => {
    expect(
      resolveAuthRouteTarget(
        routeInputs({ hasError: true, cachedIsSignedIn: true }),
      ),
    ).toBe('auth');
  });
});

describe('isInternalRoutePath', () => {
  it('accepts absolute in-app paths', () => {
    expect(isInternalRoutePath('/(tabs)/(saved)')).toBe(true);
    expect(isInternalRoutePath('/schedule-toolbar/profile')).toBe(true);
    expect(isInternalRoutePath('/comp-data/records')).toBe(true);
  });

  it('rejects the bare labels that used to be passed as `from`', () => {
    // Regression: the schedule tab sent `from: "info"` and sign-in only
    // guarded against the unrelated literal "feature", so `router.replace`
    // resolved "info" relative to /(auth)/sign-in and landed nowhere.
    expect(isInternalRoutePath('info')).toBe(false);
    expect(isInternalRoutePath('feature')).toBe(false);
    expect(isInternalRoutePath('')).toBe(false);
    expect(isInternalRoutePath(undefined)).toBe(false);
    expect(isInternalRoutePath(['/(tabs)'])).toBe(false);
  });

  it('rejects anything that could navigate off-app', () => {
    expect(isInternalRoutePath('https://example.com')).toBe(false);
    expect(isInternalRoutePath('//example.com')).toBe(false);
    expect(isInternalRoutePath('meetcal://meet/x')).toBe(false);
  });
});
