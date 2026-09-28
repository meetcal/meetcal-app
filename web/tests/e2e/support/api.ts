import type { Page, Route } from "@playwright/test";

export async function mockSubscribedUser(page: Page) {
  await page.route(/cdn\.jsdelivr\.net\/npm\/@clerk\/ui@/, async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: "window.__internal_ClerkUICtor = function ClerkUI() {};",
    });
  });
  await page.route(/cdn\.jsdelivr\.net\/npm\/@clerk\/clerk-js@/, async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: `window.Clerk = {
        isSignedIn: true,
        user: { id: "user_ci" },
        load: async () => {},
        addListener: () => {},
        mountUserButton: (element) => { element.textContent = "Test User"; },
        unmountUserButton: () => {},
        mountSignIn: () => {},
        unmountSignIn: () => {},
        openSignIn: () => {}
      };`,
    });
  });
  await page.route(/unpkg\.com\/@revenuecat\/purchases-js@/, async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: `(() => {
        const purchases = {
          getAppUserId: () => "user_ci",
          changeUser: async () => {},
          getCustomerInfo: async () => ({ entitlements: { active: { pro: {} } } })
        };
        window.Purchases = { Purchases: {
          isConfigured: () => false,
          configure: () => purchases,
          getSharedInstance: () => purchases
        }};
      })();`,
    });
  });
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

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
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
  await page.route(CONVEX_QUERY_URL, async (route) => {
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

/** Convex's answer to a query that ran and failed. */
export function errorAnswer(message: string) {
  return { status: 560, ...jsonResponse({ status: "error", errorMessage: message, logLines: [] }) };
}
