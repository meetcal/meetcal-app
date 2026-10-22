import { expect, test, type Page } from "@playwright/test";
import { errorAnswer, mockAuth, routeQuery, textAnswer, valueAnswer } from "./support/api";

type AuthMockState = {
  signInMounts: Array<Record<string, unknown>>;
  customerInfoCalls: number;
  customerInfoError?: string;
  /** Replaces the entitlements the mock grants `user_ci`. */
  activeEntitlements?: Record<string, unknown>;
  notify: () => void;
  setUser: (id: string | null) => void;
  installPurchases: () => void;
};

/** Counts the Convex reads a page makes; a gated page that is not unlocked must make none. */
function countConvexReads(page: Page) {
  const reads: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(".convex.cloud/api/query") && request.method() === "POST") {
      reads.push(String(request.postDataJSON()?.path));
    }
  });
  return reads;
}

const authMock = (page: Page) => page.evaluate(() => {
  const mock = (window as unknown as { __authMock: AuthMockState }).__authMock;
  return { signInMounts: mock.signInMounts, customerInfoCalls: mock.customerInfoCalls };
});

/** A client-side move through the header's Competition Data menu. */
async function openFromHeader(page: Page, path: string) {
  await page.locator(`.site-nav a[href="${path}"]`).dispatchEvent("click");
  await expect(page).toHaveURL(new RegExp(`${path.replace("?", "\\?")}$`));
}

test("signed out, a data page shows the sign-in that returns to it, and reads no data", async ({ page }) => {
  await mockAuth(page, { signedIn: false });
  const reads = countConvexReads(page);

  await page.goto("/results?athlete=Ann%20Lee");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to continue" })).toBeVisible();
  await expect.poll(async () => (await authMock(page)).signInMounts.length).toBeGreaterThan(0);
  const [options] = (await authMock(page)).signInMounts;
  expect(options.fallbackRedirectUrl).toBe(page.url());
  expect(options.signUpFallbackRedirectUrl).toBe(page.url());
  expect(String(options.fallbackRedirectUrl)).toContain("/results?athlete=Ann%20Lee");
  expect(reads).toEqual([]);
});

test("signed in without the subscription, a data page hands off to the app and reads no data", async ({ page }) => {
  const { passRequests, entitlementRefreshes } = await mockAuth(page, { entitlements: [] });
  const reads = countConvexReads(page);

  await page.goto("/records");
  await expect(page.getByRole("heading", { level: 1, name: "Continue in the MeetCal app" })).toBeVisible();
  expect(reads).toEqual([]);
  expect(passRequests).toEqual([]);
  expect(entitlementRefreshes).toEqual([]);
});

test("another entitlement than the app's Subscriptions does not unlock the data pages", async ({ page }) => {
  await mockAuth(page, { entitlements: ["atlas_pro"] });
  const reads = countConvexReads(page);

  await page.goto("/standards");
  await expect(page.getByRole("heading", { level: 1, name: "Continue in the MeetCal app" })).toBeVisible();
  expect(reads).toEqual([]);
});

test("a failed RevenueCat check explains itself and Try again checks again", async ({ page }) => {
  await mockAuth(page, { revenueCatError: "RevenueCat is down" });
  const reads = countConvexReads(page);

  await page.goto("/standards");
  await expect(page.getByRole("heading", { level: 1, name: "We couldn’t verify your access" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("RevenueCat is down");
  expect(reads).toEqual([]);

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "We couldn’t verify your access" })).toBeVisible();
  expect((await authMock(page)).customerInfoCalls).toBe(2);
});

test("a RevenueCat script that failed to load is fetched again on the next data page", async ({ page }) => {
  let scriptRequests = 0;
  // RevenueCat is left off the page, so the bridge loads its script, which fails here.
  await mockAuth(page, { loadRevenueCat: true });
  await page.route(/unpkg\.com\/@revenuecat\/purchases-js@/, async (route) => {
    scriptRequests += 1;
    await route.abort("failed");
  });
  await routeQuery(page, "reference:standards", (route) => route.fulfill(textAnswer([])));

  await page.goto("/records");
  await expect(page.getByRole("heading", { level: 1, name: "We couldn’t verify your access" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("The subscription service could not be loaded");
  expect(scriptRequests).toBe(1);

  // The next data page loads the script afresh instead of waiting on the failed tag.
  await openFromHeader(page, "/standards");
  await expect.poll(() => scriptRequests).toBe(2);
  await expect(page.getByRole("heading", { level: 1, name: "We couldn’t verify your access" })).toBeVisible();

  // Once RevenueCat is available, Try again unlocks the page.
  await page.evaluate(() => (window as unknown as { __authMock: AuthMockState }).__authMock.installPurchases());
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Standards" })).toBeVisible();
});

test("a RevenueCat script that never finishes loading is given up, and Try again loads it afresh", async ({ page }) => {
  await page.clock.install();
  await mockAuth(page, { loadRevenueCat: true });
  // The script never arrives. (The browser may share one stalled request
  // between tags for the same URL, so this counts tags, not requests.)
  await page.route(/unpkg\.com\/@revenuecat\/purchases-js@/, () => {});
  const revenueCatTags = page.locator('script[src*="@revenuecat/purchases-js@"]');

  await page.goto("/records");
  await expect(revenueCatTags).toHaveCount(1);
  await page.clock.fastForward("00:16");
  await expect(page.getByRole("alert")).toContainText("The subscription service could not be loaded");
  // The hung tag is given up, not left for the next check to wait on.
  await expect(revenueCatTags).toHaveCount(0);

  // Try again inserts a fresh tag, and once RevenueCat is available the page unlocks.
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(revenueCatTags).toHaveCount(1);
  await page.evaluate(() => (window as unknown as { __authMock: AuthMockState }).__authMock.installPurchases());
  await page.clock.fastForward("00:16");
  await expect(page.getByRole("alert")).toContainText("The subscription service could not be loaded");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Records" })).toBeVisible();
});

test("moving between data pages and Clerk updates for the same user keep the page and its access", async ({ page }) => {
  await mockAuth(page);
  await routeQuery(page, "reference:records", (route) => route.fulfill(textAnswer([])));
  await routeQuery(page, "reference:standards", (route) => route.fulfill(textAnswer([])));
  await routeQuery(page, "results:search", (route) => route.fulfill(valueAnswer({ matched_name: null, suggestions: [], results: [] })));

  await page.goto("/results");
  const athleteSearch = page.getByLabel("Athlete", { exact: true });
  await athleteSearch.fill("Ann Lee");

  // Clerk calls its listeners again for the same user (a session touch on focus).
  await page.evaluate(() => (window as unknown as { __authMock: AuthMockState }).__authMock.notify());
  await page.waitForTimeout(200);
  await expect(page.getByRole("heading", { level: 1, name: "Checking your access" })).toHaveCount(0);
  await expect(athleteSearch).toHaveValue("Ann Lee");

  const checking: string[] = [];
  await page.exposeFunction("__sawChecking", (path: string) => checking.push(path));
  await page.evaluate(() => {
    new MutationObserver(() => {
      if (document.body.textContent?.includes("Checking your access")) {
        (window as unknown as { __sawChecking: (path: string) => void }).__sawChecking(location.pathname);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await openFromHeader(page, "/records");
  await expect(page.getByRole("heading", { level: 1, name: "Records" })).toBeVisible();
  await openFromHeader(page, "/standards");
  await expect(page.getByRole("heading", { level: 1, name: "Standards" })).toBeVisible();

  expect(checking).toEqual([]);
  expect((await authMock(page)).customerInfoCalls).toBe(1);
});

test("switching to an unsubscribed user or signing out locks an open data page", async ({ page }) => {
  await mockAuth(page);
  await routeQuery(page, "reference:standards", (route) => route.fulfill(textAnswer([])));

  await page.goto("/standards");
  await expect(page.getByRole("heading", { level: 1, name: "Standards" })).toBeVisible();

  await page.evaluate(() => (window as unknown as { __authMock: AuthMockState }).__authMock.setUser("user_other"));
  await expect(page.getByRole("heading", { level: 1, name: "Continue in the MeetCal app" })).toBeVisible();

  await page.evaluate(() => (window as unknown as { __authMock: AuthMockState }).__authMock.setUser(null));
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to continue" })).toBeVisible();

  await page.evaluate(() => (window as unknown as { __authMock: AuthMockState }).__authMock.setUser("user_ci"));
  await expect(page.getByRole("heading", { level: 1, name: "Standards" })).toBeVisible();
});

test("a stale grant is checked again in the background, and a failed check keeps the page", async ({ page }) => {
  await page.clock.install();
  await mockAuth(page);
  await routeQuery(page, "reference:records", (route) => route.fulfill(textAnswer([])));
  await routeQuery(page, "reference:standards", (route) => route.fulfill(textAnswer([])));

  await page.goto("/records");
  await expect(page.getByRole("heading", { level: 1, name: "Records" })).toBeVisible();
  expect((await authMock(page)).customerInfoCalls).toBe(1);

  await page.clock.fastForward("11:00");
  await page.evaluate(() => {
    (window as unknown as { __authMock: AuthMockState }).__authMock.customerInfoError = "RevenueCat is down";
  });
  await openFromHeader(page, "/standards");
  await expect.poll(async () => (await authMock(page)).customerInfoCalls).toBe(2);
  await expect(page.getByRole("heading", { level: 1, name: "Standards" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "We couldn’t verify your access" })).toHaveCount(0);
});

test("a signed-in visit to a public page never checks the subscription; the first data page does", async ({ page }) => {
  let scriptRequests = 0;
  await mockAuth(page, { loadRevenueCat: true });
  await page.route(/unpkg\.com\/@revenuecat\/purchases-js@/, async (route) => {
    scriptRequests += 1;
    await route.abort("failed");
  });
  await routeQuery(page, "reference:standards", (route) => route.fulfill(textAnswer([])));

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.waitForTimeout(300);
  expect(scriptRequests).toBe(0);
  expect((await authMock(page)).customerInfoCalls).toBe(0);

  // The first data page checks the entitlement.
  await page.evaluate(() => (window as unknown as { __authMock: AuthMockState }).__authMock.installPurchases());
  await openFromHeader(page, "/standards");
  await expect(page.getByRole("heading", { level: 1, name: "Standards" })).toBeVisible();
  expect((await authMock(page)).customerInfoCalls).toBe(1);
});

test("an unpaid user who subscribes in the app gets in on returning to the tab", async ({ page }) => {
  await mockAuth(page, { entitlements: [] });
  await routeQuery(page, "reference:records", (route) => route.fulfill(textAnswer([])));

  await page.goto("/records");
  await expect(page.getByRole("heading", { level: 1, name: "Continue in the MeetCal app" })).toBeVisible();
  expect((await authMock(page)).customerInfoCalls).toBe(1);

  // Subscribed in the app; Clerk reports the same user, so only the return to the tab rechecks.
  await page.evaluate(() => {
    const mock = (window as unknown as { __authMock: AuthMockState }).__authMock;
    mock.activeEntitlements = { Subscriptions: { identifier: "Subscriptions" } };
    mock.notify();
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
  });
  await expect(page.getByRole("heading", { level: 1, name: "Records" })).toBeVisible();
  expect((await authMock(page)).customerInfoCalls).toBe(2);
});

test("a subscriber's premium reads carry the access pass, fetched once with the session token, and no read carries the token", async ({ page }) => {
  const { passRequests, entitlementRefreshes } = await mockAuth(page);
  const sent = new Map<string, { pass: unknown; authorization: string | undefined }>();
  for (const [fn, answer] of [
    ["reference:clubs", textAnswer(["Test Barbell"])],
    ["reference:clubMeets", valueAnswer({ meets: [], truncated: false })],
    ["reference:standards", textAnswer([])],
    ["meets:list", textAnswer([])],
    ["meets:completed", textAnswer([])],
  ] as const) {
    await routeQuery(page, fn, (route, args) => {
      sent.set(fn, { pass: args.pass, authorization: route.request().headers().authorization });
      return route.fulfill(answer);
    });
  }

  await page.goto("/club-dashboard");
  await page.getByLabel("Club").selectOption("Test Barbell");
  await expect(page.getByText("This club has no completed meets yet.")).toBeVisible();
  expect(sent.get("reference:clubs")).toEqual({ pass: "pass_test", authorization: undefined });
  expect(sent.get("reference:clubMeets")).toEqual({ pass: "pass_test", authorization: undefined });

  // The pass is held: the next data page's read uses it without fetching it again.
  await openFromHeader(page, "/standards");
  await expect(page.getByRole("heading", { level: 1, name: "Standards" })).toBeVisible();
  await expect.poll(() => sent.get("reference:standards")).toEqual({ pass: "pass_test", authorization: undefined });
  expect(passRequests).toEqual(["Bearer token_user_ci"]);
  expect(entitlementRefreshes).toEqual([]);

  // Public, so it goes without the pass.
  await openFromHeader(page, "/meet-center");
  await expect.poll(() => sent.get("meets:completed")).toEqual({ pass: undefined, authorization: undefined });
});

test("a subscriber Convex has no entitlement for yet gets the pass once Convex refreshes it", async ({ page }) => {
  const { passRequests, entitlementRefreshes } = await mockAuth(page, { serverEntitled: false });
  const sent: unknown[] = [];
  await routeQuery(page, "reference:standards", (route, args) => {
    sent.push(args.pass);
    return route.fulfill(textAnswer([]));
  });

  await page.goto("/standards");
  await expect(page.getByRole("heading", { level: 1, name: "Standards" })).toBeVisible();
  await expect.poll(() => sent).toEqual(["pass_test"]);
  expect(passRequests).toEqual(["Bearer token_user_ci", "Bearer token_user_ci"]);
  expect(entitlementRefreshes).toEqual(["Bearer token_user_ci"]);
});

for (const [name, setup, refreshes] of [
  ["Convex finds no entitlement", (page: Page) => mockAuth(page, { serverEntitled: false, refreshGrants: false }), 1],
  [
    "the pass cannot be fetched",
    async (page: Page) => {
      const mocks = await mockAuth(page);
      await routeQuery(page, "accessPass:pass", (route) => route.abort("failed"));
      return mocks;
    },
    0,
  ],
] as const) {
  test(`when ${name}, a premium read goes out without a pass`, async ({ page }) => {
    const { entitlementRefreshes } = await setup(page);
    const sent: Array<Record<string, unknown>> = [];
    await routeQuery(page, "reference:standards", (route, args) => {
      sent.push(args);
      return route.fulfill(textAnswer([]));
    });

    await page.goto("/standards");
    await expect(page.getByRole("heading", { level: 1, name: "Standards" })).toBeVisible();
    await expect.poll(() => sent).toEqual([{}]);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(entitlementRefreshes).toHaveLength(refreshes);
  });
}

for (const status of [401, 403]) {
  test(`a read Convex refuses for its pass (${status}) fetches a fresh pass and goes again once`, async ({ page }) => {
    const { server, passRequests } = await mockAuth(page);
    server.pass = "pass_old";
    const sent: unknown[] = [];
    await routeQuery(page, "reference:standards", (route, args) => {
      sent.push(args.pass);
      if (args.pass !== "pass_old") return route.fulfill(textAnswer([]));
      // Convex rotated the pass and no longer accepts this one.
      server.pass = "pass_new";
      return route.fulfill(errorAnswer("Server Error", { status, error: "access pass expired" }));
    });

    await page.goto("/standards");
    await expect(page.getByRole("heading", { level: 1, name: "Standards" })).toBeVisible();
    await expect.poll(() => sent).toEqual(["pass_old", "pass_new"]);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(passRequests).toHaveLength(2);
  });
}

test("a read Convex refuses again with a fresh pass shows its error instead of retrying more", async ({ page }) => {
  const { passRequests } = await mockAuth(page);
  let reads = 0;
  await routeQuery(page, "reference:standards", (route) => {
    reads += 1;
    return route.fulfill(errorAnswer("Server Error", { status: 403, error: "access pass expired" }));
  });

  await page.goto("/standards");
  await expect(page.getByRole("alert")).toContainText("access pass expired");
  expect(reads).toBe(2);
  expect(passRequests).toHaveLength(2);
});
