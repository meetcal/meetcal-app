import type { Page, Route } from "@playwright/test";

export type AuthMock = {
  signedIn?: boolean;
  serverEntitled?: boolean;
  refreshGrants?: boolean;
};

export type PassServer = {
  pass: string;
  entitled: boolean;
  refreshGrants: boolean;
  unavailable: boolean;
  rotatesInMs: number;
};

export async function mockAuth(
  page: Page,
  { signedIn = true, serverEntitled = true, refreshGrants = true }: AuthMock = {},
) {
  await page.addInitScript(({ signedIn }) => {
    type Listener = () => void;
    type ClerkUser = { id: string; primaryEmailAddress: { emailAddress: string } };
    const clerkUser = (id: string): ClerkUser => ({ id, primaryEmailAddress: { emailAddress: `${id}@example.com` } });
    const mock = {
      signInMounts: [] as unknown[],
      listeners: [] as Listener[],
      notify: () => mock.listeners.forEach((listener) => listener()),
      setUser: (id: string | null) => {
        clerk.isSignedIn = id !== null;
        clerk.user = id === null ? null : clerkUser(id);
        mock.notify();
      },
    };
    const clerk = {
      isSignedIn: signedIn,
      user: signedIn ? (clerkUser("user_ci") as ClerkUser | null) : null,
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
    Object.assign(window, { __authMock: mock, __internal_ClerkUICtor: function ClerkUI() {}, Clerk: clerk });
  }, { signedIn });

  const revenueCatRequests: string[] = [];
  page.on("request", (request) => {
    if (/revenuecat|revenue\.cat/i.test(request.url())) revenueCatRequests.push(request.url());
  });

  await page.route(CONVEX_API_URL, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }
    const body = route.request().postDataJSON() as { path?: string } | null;
    await route.fulfill(errorAnswer(`${body?.path ?? "a Convex function"} is not mocked in this test`));
  });

  for (const categories of ["reference:recordCategories", "reference:qualifyingTotalCategories"]) {
    await routeQuery(page, categories, (route) => route.fulfill(textAnswer([])));
  }

  const server: PassServer = {
    pass: "pass_test",
    entitled: serverEntitled,
    refreshGrants,
    unavailable: false,
    rotatesInMs: 24 * 60 * 60 * 1000,
  };
  const passRequests: Array<string | undefined> = [];
  const accessCalls: Array<"pass" | "refresh"> = [];
  await routeQuery(page, "accessPass:pass", (route) => {
    const authorization = route.request().headers().authorization;
    passRequests.push(authorization);
    accessCalls.push("pass");
    if (!authorization) return route.fulfill(errorAnswer("Server Error", { status: 401, error: "unauthorized" }));
    if (server.unavailable) return route.fulfill(errorAnswer("Server Error", { status: 503, error: "no access pass yet" }));
    if (authorization !== "Bearer token_user_ci" || !server.entitled) {
      return route.fulfill(errorAnswer("Server Error", { status: 403, error: "subscription required" }));
    }
    return route.fulfill(valueAnswer({ pass: server.pass, rotatesAt: Date.now() + server.rotatesInMs }));
  });

  await routeQuery(page, "results:athlete", (route) => route.fulfill(valueAnswer(NAME_WITHOUT_LIFTERS)));

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
    accessCalls.push("refresh");
    const active = server.refreshGrants && authorization === "Bearer token_user_ci";
    if (active) server.entitled = true;
    await route.fulfill(valueAnswer({ active }));
  });
  return { server, passRequests, entitlementRefreshes, accessCalls, revenueCatRequests };
}

export const NAME_WITHOUT_LIFTERS = {
  kind: "results",
  lifter: null,
  json: "[]",
  prs: { set: { snatch: [], cj: [], total: [] }, current: { snatch: null, cj: null, total: null } },
  year_bests: null,
};

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

/** Every read is a `POST` of `{ path, args }` here (see src/utils/api/). */
const CONVEX_QUERY_URL = "https://disciplined-hare-790.convex.cloud/api/query";
/** The mutations the site calls: `deviceLogin:approve` and `deviceLogin:deny` (`/link`), `meetSubmissions:*` (`/submit-meet`). */
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

/** Answers the Convex action `fn` (such as `results:wsoElite`), as `routeQuery` answers a query. */
export async function routeAction(
  page: Page,
  fn: string,
  handler: (route: Route, args: Record<string, unknown>) => Promise<void> | void,
) {
  await routeFunction(page, CONVEX_ACTION_URL, fn, handler);
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

type NarrowedTable = "records" | "qualifyingTotals";

const NARROWED: Record<NarrowedTable, { categories: string; kind: string; argument: string }> = {
  records: { categories: "reference:recordCategories", kind: "record_type", argument: "federation" },
  qualifyingTotals: { categories: "reference:qualifyingTotalCategories", kind: "event_name", argument: "event" },
};

export async function routeNarrowedTable(page: Page, table: NarrowedTable, rows: Array<Record<string, unknown>>) {
  const { categories, kind, argument } = NARROWED[table];
  const distinct = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const category = { [kind]: row[kind], gender: row.gender, age_category: row.age_category };
    distinct.set(JSON.stringify(category), category);
  }
  await routeQuery(page, categories, (route) => route.fulfill(textAnswer([...distinct.values()])));
  const asked: Array<Record<string, unknown>> = [];
  const same = (value: unknown, filter: unknown) =>
    filter === undefined || String(value).trim().toLowerCase() === String(filter).trim().toLowerCase();
  await routeQuery(page, `reference:${table}`, (route, args) => {
    asked.push(args);
    return route.fulfill(
      textAnswer(rows.filter((row) => same(row[kind], args[argument]) && same(row.gender, args.gender) && same(row.age_category, args.ageCategory))),
    );
  });
  return asked;
}

/** Convex's answer to a query whose value is the body. */
export function valueAnswer(value: unknown) {
  return jsonResponse({ status: "success", value, logLines: [] });
}

/** Convex's answer to a query that sends its body as JSON text (`{ etag, json }`). */
export function textAnswer(body: unknown) {
  return valueAnswer({ etag: '"test"', json: JSON.stringify(body) });
}

export function errorAnswer(message: string, errorData?: { status: number; error: string; code?: string }) {
  const body = { status: "error", errorMessage: message, ...(errorData ? { errorData } : {}), logLines: [] };
  return { status: 560, ...jsonResponse(body) };
}
