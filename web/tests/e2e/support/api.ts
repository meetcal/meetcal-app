import type { Page } from "@playwright/test";

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
