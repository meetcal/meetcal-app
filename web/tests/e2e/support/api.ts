import type { Page, Route } from "@playwright/test";

export type AuthMock = {
  /** Clerk reports a signed-in user (`user_ci`). Default true. */
  signedIn?: boolean;
  /** The active RevenueCat entitlements. Default `["Subscriptions"]`, the one the app checks. */
  entitlements?: string[];
  /** `getCustomerInfo` rejects with this message. */
  revenueCatError?: string;
  /**
   * Leave RevenueCat off the page, so the bridge loads its script (which a
   * test can then route); `window.__authMock.installPurchases()` puts the
   * stand-in on the page later.
   */
  loadRevenueCat?: boolean;
  /**
   * Convex holds an active entitlement for `user_ci`, so `accessPass:pass`
   * answers it the pass. Default true; false answers 403 until
   * `entitlements:refresh` grants it.
   */
  serverEntitled?: boolean;
  /** What `entitlements:refresh` answers as `active`. Default true. */
  refreshGrants?: boolean;
};

/**
 * Convex's side of the access pass in the mocks: the pass it hands out, and
 * whether it holds `user_ci`'s entitlement. A test may change either.
 */
export type PassServer = {
  pass: string;
  entitled: boolean;
};

/**
 * Puts stand-ins for the Clerk and RevenueCat SDKs on the page: the auth
 * bridge uses an SDK already on the page instead of loading it, and a mocked
 * CDN file would fail its integrity check. The stand-ins record what the site
 * asked of them on `window.__authMock`: `mountSignIn` options and
 * `getCustomerInfo` calls. `notify()` calls Clerk's listeners again;
 * `setUser(id | null)` switches or signs out the Clerk user and notifies;
 * setting `customerInfoError` makes later checks fail, and
 * `activeEntitlements` replaces the granted entitlements. Only `user_ci`
 * holds entitlements. A signed-in user's session token is `token_<id>`.
 *
 * Also answers the Convex calls that carry that token: `accessPass:pass` answers `server.pass` (default
 * `pass_test`) to `Bearer token_user_ci` while `server.entitled`, 403 to
 * another user or while not entitled, and 401 without a token; the
 * `entitlements:refresh` action answers `{ active: refreshGrants }` and, when
 * active, makes `server.entitled` true. Any other Convex call the test does
 * not route fails with an `errorAnswer`, so no test reaches the real
 * deployment (it once sent `pass_test` to production's `reference:records`).
 * Returns `server`, and the
 * Authorization header of each call: `passRequests` and
 * `entitlementRefreshes`.
 */
export async function mockAuth(
  page: Page,
  { signedIn = true, entitlements = ["Subscriptions"], revenueCatError, loadRevenueCat = false, serverEntitled = true, refreshGrants = true }: AuthMock = {},
) {
  const active = Object.fromEntries(entitlements.map((id) => [id, { identifier: id }]));
  await page.addInitScript(({ signedIn, active, revenueCatError, loadRevenueCat }) => {
    type Listener = () => void;
    const mock = {
      signInMounts: [] as unknown[],
      customerInfoCalls: 0,
      listeners: [] as Listener[],
      customerInfoError: revenueCatError as string | undefined,
      activeEntitlements: undefined as Record<string, unknown> | undefined,
      notify: () => mock.listeners.forEach((listener) => listener()),
      setUser: (id: string | null) => {
        clerk.isSignedIn = id !== null;
        clerk.user = id === null ? null : { id };
        mock.notify();
      },
      installPurchases: () => Object.assign(window, { Purchases: { Purchases: revenueCat } }),
    };
    const clerk = {
      isSignedIn: signedIn,
      user: signedIn ? ({ id: "user_ci" } as { id: string } | null) : null,
      load: async () => {},
      addListener: (listener: Listener) => {
        mock.listeners.push(listener);
      },
      mountUserButton: (element: HTMLElement, options: unknown) => {
        element.textContent = "Test User";
        Object.assign(window, { __userButtonOptions: options });
      },
      unmountUserButton: () => {},
      mountSignIn: (_element: HTMLElement, options: unknown) => {
        mock.signInMounts.push(options);
      },
      unmountSignIn: () => {},
      openSignIn: () => {},
      get session() {
        const user = clerk.user;
        return clerk.isSignedIn && user ? { getToken: async () => `token_${user.id}` } : null;
      },
    };
    let appUserId: string | null = null;
    const purchases = {
      getAppUserId: () => appUserId,
      changeUser: async (id: string) => {
        appUserId = id;
      },
      getCustomerInfo: async () => {
        mock.customerInfoCalls += 1;
        if (mock.customerInfoError) throw new Error(mock.customerInfoError);
        return { entitlements: { active: appUserId === "user_ci" ? (mock.activeEntitlements ?? active) : {} } };
      },
    };
    const revenueCat = {
      isConfigured: () => appUserId !== null,
      configure: ({ appUserId: id }: { appUserId: string }) => {
        appUserId = id;
        return purchases;
      },
      getSharedInstance: () => purchases,
    };
    Object.assign(window, { __authMock: mock, __internal_ClerkUICtor: function ClerkUI() {}, Clerk: clerk });
    if (!loadRevenueCat) mock.installPurchases();
  }, { signedIn, active, revenueCatError, loadRevenueCat });

  // Routed first, so every route a test adds later answers before it.
  await page.route(CONVEX_API_URL, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }
    const body = route.request().postDataJSON() as { path?: string } | null;
    await route.fulfill(errorAnswer(`${body?.path ?? "a Convex function"} is not mocked in this test`));
  });

  const server: PassServer = { pass: "pass_test", entitled: serverEntitled };
  const passRequests: Array<string | undefined> = [];
  await routeQuery(page, "accessPass:pass", (route) => {
    const authorization = route.request().headers().authorization;
    passRequests.push(authorization);
    if (!authorization) return route.fulfill(errorAnswer("Server Error", { status: 401, error: "unauthorized" }));
    if (authorization !== "Bearer token_user_ci" || !server.entitled) {
      return route.fulfill(errorAnswer("Server Error", { status: 403, error: "subscription required" }));
    }
    return route.fulfill(valueAnswer({ pass: server.pass, rotatesAt: Date.now() + 24 * 60 * 60 * 1000 }));
  });

  const entitlementRefreshes: Array<string | undefined> = [];
  await page.route(CONVEX_ACTION_URL, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }
    const body = request.postDataJSON() as { path?: string } | null;
    if (body?.path !== "entitlements:refresh") {
      await route.fallback();
      return;
    }
    const authorization = request.headers().authorization;
    entitlementRefreshes.push(authorization);
    const active = refreshGrants && authorization === "Bearer token_user_ci";
    if (active) server.entitled = true;
    await route.fulfill(valueAnswer({ active }));
  });
  return { server, passRequests, entitlementRefreshes };
}

/** A signed-in user with the app's subscription entitlement. */
export async function mockSubscribedUser(page: Page) {
  await mockAuth(page);
}

export function jsonResponse(body: unknown) {
  return {
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  };
}

export function retryableResponse(status: 429 | 503, retryAfter?: string) {
  const response = jsonResponse({ error: status === 429 ? "rate limited" : "overloaded" });
  return {
    ...response,
    status,
    headers: {
      ...response.headers,
      "access-control-expose-headers": "retry-after",
      ...(retryAfter === undefined ? {} : { "retry-after": retryAfter }),
    },
  };
}

/** Every read is a `POST` of `{ path, args }` here (see src/utils/api.rs). */
const CONVEX_QUERY_URL = "https://disciplined-hare-790.convex.cloud/api/query";
/** The mutations the site calls: `deviceLogin:approve` and `deviceLogin:deny` (`/link`). */
const CONVEX_MUTATION_URL = "https://disciplined-hare-790.convex.cloud/api/mutation";
/** The one action the site calls, `entitlements:refresh`. */
const CONVEX_ACTION_URL = "https://disciplined-hare-790.convex.cloud/api/action";
/** Every Convex call: queries, mutations and actions. */
const CONVEX_API_URL = "https://disciplined-hare-790.convex.cloud/api/**";

/** `accessPass:pass`, `entitlements:refresh` and the `deviceLogin` calls carry `Authorization`, so the preflight must allow it. */
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
};

/**
 * Answers the Convex query `fn` (such as `reference:records`) with
 * `handler`; other queries fall through to routes registered before this one.
 * The JSON body makes each read a CORS preflighted request, which every such
 * route answers.
 */
export async function routeQuery(
  page: Page,
  fn: string,
  handler: (route: Route, args: Record<string, unknown>) => Promise<void> | void,
) {
  await routeFunction(page, CONVEX_QUERY_URL, fn, handler);
}

/** Answers the Convex mutation `fn` (such as `deviceLogin:approve`), as `routeQuery` answers a query. */
export async function routeMutation(
  page: Page,
  fn: string,
  handler: (route: Route, args: Record<string, unknown>) => Promise<void> | void,
) {
  await routeFunction(page, CONVEX_MUTATION_URL, fn, handler);
}

async function routeFunction(
  page: Page,
  url: string,
  fn: string,
  handler: (route: Route, args: Record<string, unknown>) => Promise<void> | void,
) {
  await page.route(url, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }
    const body = request.postDataJSON() as { path?: string; args?: Record<string, unknown> } | null;
    if (body?.path !== fn) {
      await route.fallback();
      return;
    }
    await handler(route, body.args ?? {});
  });
}

/** Convex's answer to a query whose value is the body. */
export function valueAnswer(value: unknown) {
  return jsonResponse({ status: "success", value, logLines: [] });
}

/** Convex's answer to a query that sends its body as JSON text (`{ etag, json }`). */
export function textAnswer(body: unknown) {
  return valueAnswer({ etag: '"test"', json: JSON.stringify(body) });
}

/** Convex's answer to a query that ran and failed; `errorData` is a `ConvexError`'s `{ status, error }`. */
export function errorAnswer(message: string, errorData?: { status: number; error: string }) {
  const body = { status: "error", errorMessage: message, ...(errorData ? { errorData } : {}), logLines: [] };
  return { status: 560, ...jsonResponse(body) };
}
