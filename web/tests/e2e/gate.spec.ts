import { expect, test, type Page } from "@playwright/test";
import { mockAuth, routeQuery, textAnswer, valueAnswer } from "./support/api";

type AuthMockState = {
  signInMounts: Array<Record<string, unknown>>;
  customerInfoCalls: number;
  customerInfoError?: string;
  /** Replaces the entitlements the mock grants `user_ci`. */
  activeEntitlements?: Record<string, unknown>;
  notify: () => void;
  setUser: (id: string | null) => void;
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
  await mockAuth(page, { entitlements: [] });
  const reads = countConvexReads(page);

  await page.goto("/records");
  await expect(page.getByRole("heading", { level: 1, name: "Continue in the MeetCal app" })).toBeVisible();
  expect(reads).toEqual([]);
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
  await mockAuth(page);
  // Registered after the mock, so it answers first: fail the first load only.
  await page.route(/unpkg\.com\/@revenuecat\/purchases-js@/, async (route) => {
    scriptRequests += 1;
    if (scriptRequests === 1) {
      await route.abort("failed");
      return;
    }
    await route.fallback();
  });
  await routeQuery(page, "reference:standards", (route) => route.fulfill(textAnswer([])));

  await page.goto("/records");
  await expect(page.getByRole("heading", { level: 1, name: "We couldn’t verify your access" })).toBeVisible();

  await openFromHeader(page, "/standards");
  await expect(page.getByRole("heading", { level: 1, name: "Standards" })).toBeVisible();
  expect(scriptRequests).toBe(2);
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
  await mockAuth(page);
  await page.route(/unpkg\.com\/@revenuecat\/purchases-js@/, async (route) => {
    scriptRequests += 1;
    await route.fallback();
  });
  await routeQuery(page, "reference:standards", (route) => route.fulfill(textAnswer([])));

  await page.goto("/");
  await expect(page.locator(".site-nav")).toBeVisible();
  await page.waitForTimeout(300);
  expect(scriptRequests).toBe(0);

  await openFromHeader(page, "/standards");
  await expect(page.getByRole("heading", { level: 1, name: "Standards" })).toBeVisible();
  expect(scriptRequests).toBe(1);
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
