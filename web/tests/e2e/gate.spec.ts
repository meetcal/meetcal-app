import { expect, test, type Page } from "@playwright/test";
import { errorAnswer, mockAuth, routeQuery, textAnswer, valueAnswer } from "./support/api";

type AuthMockState = {
  signInMounts: Array<Record<string, unknown>>;
  notify: () => void;
  setUser: (id: string | null) => void;
};

const ACCESS_PASS = "accessPass:pass";

function countDataReads(page: Page) {
  const reads: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(".convex.cloud/api/query") && request.method() === "POST") {
      const path = String(request.postDataJSON()?.path);
      if (path !== ACCESS_PASS) reads.push(path);
    }
  });
  return reads;
}

const signInMounts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __authMock: AuthMockState }).__authMock.signInMounts);

const authMock = (page: Page) => ({
  notify: () => page.evaluate(() => (window as unknown as { __authMock: AuthMockState }).__authMock.notify()),
  setUser: (id: string | null) =>
    page.evaluate((id) => (window as unknown as { __authMock: AuthMockState }).__authMock.setUser(id), id),
});

async function openFromHeader(page: Page, path: string) {
  await page.locator(`.site-nav a[href="${path}"]`).dispatchEvent("click");
  await expect(page).toHaveURL(new RegExp(`${path.replace("?", "\\?")}$`));
}

const paywall = (page: Page) => page.getByRole("heading", { level: 1, name: "Continue in the MeetCal app" });
const signIn = (page: Page) => page.getByRole("heading", { level: 1, name: "Sign in to continue" });
const accessError = (page: Page) => page.getByRole("heading", { level: 1, name: "We couldn’t verify your access" });

test("signed out, a data page shows the sign-in that returns to it, and reads no data", async ({ page }) => {
  const { passRequests } = await mockAuth(page, { signedIn: false });
  const reads = countDataReads(page);

  await page.goto("/results?athlete=Ann%20Lee");
  await expect(signIn(page)).toBeVisible();
  await expect.poll(async () => (await signInMounts(page)).length).toBeGreaterThan(0);
  const [options] = await signInMounts(page);
  expect(options.fallbackRedirectUrl).toBe(page.url());
  expect(options.signUpFallbackRedirectUrl).toBe(page.url());
  expect(String(options.fallbackRedirectUrl)).toContain("/results?athlete=Ann%20Lee");
  expect(reads).toEqual([]);
  expect(passRequests).toEqual([]);
});

test("a subscriber's data page asks Convex for the pass first, then reads its data, and never loads RevenueCat", async ({ page }) => {
  const { accessCalls, revenueCatRequests } = await mockAuth(page);
  const order: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(".convex.cloud/api/query") && request.method() === "POST") {
      order.push(String(request.postDataJSON()?.path));
    }
  });
  await routeQuery(page, "reference:standards", (route) => route.fulfill(textAnswer([])));

  await page.goto("/standards");
  await expect(page.getByRole("heading", { level: 1, name: "Standards" })).toBeVisible();
  await expect.poll(() => order).toEqual([ACCESS_PASS, "reference:standards"]);
  expect(accessCalls).toEqual(["pass"]);
  expect(revenueCatRequests).toEqual([]);
});

test("signed in without the subscription, Convex's refusal shows the paywall, which reads no data and loads no RevenueCat", async ({ page }) => {
  const { accessCalls, entitlementRefreshes, revenueCatRequests } = await mockAuth(page, {
    serverEntitled: false,
    refreshGrants: false,
  });
  const reads = countDataReads(page);

  await page.goto("/records");
  await expect(paywall(page)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open on iPhone or iPad" })).toBeVisible();
  expect(accessCalls).toEqual(["pass", "refresh"]);
  expect(entitlementRefreshes).toEqual(["Bearer token_user_ci"]);
  expect(reads).toEqual([]);
  expect(revenueCatRequests).toEqual([]);
});

test("an unpaid user who subscribes in the app gets in on returning to the tab: refresh, then the pass, then the data", async ({ page }) => {
  const { server, accessCalls, revenueCatRequests } = await mockAuth(page, { serverEntitled: false, refreshGrants: false });
  await routeQuery(page, "reference:records", (route) => route.fulfill(textAnswer([])));

  await page.goto("/records");
  await expect(paywall(page)).toBeVisible();
  expect(accessCalls).toEqual(["pass", "refresh"]);

  server.refreshGrants = true;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange", { bubbles: true })));
  await expect(page.getByRole("heading", { level: 1, name: "Records" })).toBeVisible();
  expect(accessCalls).toEqual(["pass", "refresh", "pass", "refresh", "pass"]);
  expect(revenueCatRequests).toEqual([]);
});

test("a pass Convex refuses as signed out (401) shows the sign-in, not the paywall", async ({ page }) => {
  await mockAuth(page);
  await routeQuery(page, ACCESS_PASS, (route) =>
    route.fulfill(errorAnswer("Server Error", { status: 401, error: "unauthorized" })),
  );
  const reads = countDataReads(page);

  await page.goto("/standards");
  await expect(signIn(page)).toBeVisible();
  await expect(paywall(page)).toHaveCount(0);
  expect(reads).toEqual([]);
});

for (const failure of ["answers 503", "cannot be reached"] as const) {
  test(`when the pass ${failure}, the data page shows the error, not the paywall, and Try again asks again`, async ({ page }) => {
    const { server, passRequests, revenueCatRequests } = await mockAuth(page);
    let reachable = failure !== "cannot be reached";
    server.unavailable = failure === "answers 503";
    await routeQuery(page, ACCESS_PASS, (route) => (reachable ? route.fallback() : route.abort("failed")));
    await routeQuery(page, "reference:standards", (route) => route.fulfill(textAnswer([])));
    const reads = countDataReads(page);

    await page.goto("/standards");
    await expect(accessError(page)).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("MeetCal couldn't check your subscription right now");
    await expect(paywall(page)).toHaveCount(0);
    expect(reads).toEqual([]);

    server.unavailable = false;
    reachable = true;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Standards" })).toBeVisible();
    expect(passRequests.at(-1)).toBe("Bearer token_user_ci");
    expect(revenueCatRequests).toEqual([]);
  });
}

test("moving between data pages and Clerk updates for the same user keep the page and its access", async ({ page }) => {
  const { passRequests } = await mockAuth(page);
  await routeQuery(page, "reference:records", (route) => route.fulfill(textAnswer([])));
  await routeQuery(page, "reference:standards", (route) => route.fulfill(textAnswer([])));
  await routeQuery(page, "results:search", (route) => route.fulfill(valueAnswer({ matched_name: null, suggestions: [], results: [], truncated: false })));

  await page.goto("/results");
  const athleteSearch = page.getByLabel("Athlete", { exact: true });
  await athleteSearch.fill("Ann Lee");

  await authMock(page).notify();
  await page.waitForTimeout(200);
  await expect(page.getByRole("status").filter({ hasText: "Checking your access" })).toHaveCount(0);
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
  expect(passRequests).toHaveLength(1);
});

test("switching to an unsubscribed user or signing out locks an open data page", async ({ page }) => {
  await mockAuth(page);
  await routeQuery(page, "reference:standards", (route) => route.fulfill(textAnswer([])));

  await page.goto("/standards");
  await expect(page.getByRole("heading", { level: 1, name: "Standards" })).toBeVisible();

  await authMock(page).setUser("user_other");
  await expect(paywall(page)).toBeVisible();

  await authMock(page).setUser(null);
  await expect(signIn(page)).toBeVisible();

  await authMock(page).setUser("user_ci");
  await expect(page.getByRole("heading", { level: 1, name: "Standards" })).toBeVisible();
});

test("a background check after the held pass ran out that cannot reach Convex keeps the open page", async ({ page }) => {
  await page.clock.install();
  const { server, passRequests } = await mockAuth(page);
  server.rotatesInMs = 0;
  await routeQuery(page, "reference:records", (route) => route.fulfill(textAnswer([])));
  await routeQuery(page, "reference:standards", (route) => route.fulfill(textAnswer([])));

  await page.goto("/records");
  await expect(page.getByRole("heading", { level: 1, name: "Records" })).toBeVisible();
  expect(passRequests).toHaveLength(1);

  await page.clock.fastForward("11:00");
  server.unavailable = true;
  await openFromHeader(page, "/standards");
  await expect.poll(() => passRequests.length).toBe(2);
  await expect(page.getByRole("heading", { level: 1, name: "Standards" })).toBeVisible();
  await expect(accessError(page)).toHaveCount(0);
});

test("a signed-in visit to a public page never asks for the pass; the first data page does", async ({ page }) => {
  const { passRequests, revenueCatRequests } = await mockAuth(page);
  await routeQuery(page, "reference:standards", (route) => route.fulfill(textAnswer([])));

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.waitForTimeout(300);
  expect(passRequests).toEqual([]);

  await openFromHeader(page, "/standards");
  await expect(page.getByRole("heading", { level: 1, name: "Standards" })).toBeVisible();
  expect(passRequests).toHaveLength(1);
  expect(revenueCatRequests).toEqual([]);
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

  await openFromHeader(page, "/standards");
  await expect(page.getByRole("heading", { level: 1, name: "Standards" })).toBeVisible();
  await expect.poll(() => sent.get("reference:standards")).toEqual({ pass: "pass_test", authorization: undefined });
  expect(passRequests).toEqual(["Bearer token_user_ci"]);
  expect(entitlementRefreshes).toEqual([]);

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

for (const status of [401, 403]) {
  test(`a read Convex refuses for its pass (${status}) fetches a fresh pass and goes again once`, async ({ page }) => {
    const { server, passRequests } = await mockAuth(page);
    server.pass = "pass_old";
    const sent: unknown[] = [];
    await routeQuery(page, "reference:standards", (route, args) => {
      sent.push(args.pass);
      if (args.pass !== "pass_old") return route.fulfill(textAnswer([]));
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

test("an answer store that never opens, as on WebKit 14, delays neither the gate nor the page's reads", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", { configurable: true, value: { open: () => ({}) } });
  });
  const { passRequests } = await mockAuth(page);
  const sent: unknown[] = [];
  await routeQuery(page, "reference:standards", (route, args) => {
    sent.push(args.pass);
    return route.fulfill(textAnswer([]));
  });

  await page.goto("/standards");
  await expect.poll(() => sent, { timeout: 5_000 }).toEqual(["pass_test"]);
  await expect(page.getByText("No standards match these filters.")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(passRequests).toHaveLength(1);
});

test("a slow pass keeps the data page checking, and its first read carries the pass once it arrives", async ({ page }) => {
  test.setTimeout(45_000);
  await mockAuth(page);
  const slowerThanAReadsOwnWaitMs = 4_500;
  await routeQuery(page, ACCESS_PASS, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, slowerThanAReadsOwnWaitMs));
    await route.fulfill(valueAnswer({ pass: "pass_slow", rotatesAt: Date.now() + 24 * 60 * 60 * 1000 }));
  });
  const sent: unknown[] = [];
  await routeQuery(page, "reference:standards", (route, args) => {
    sent.push(args.pass ?? null);
    return route.fulfill(textAnswer([]));
  });

  await page.goto("/standards");
  await expect(page.getByRole("status").filter({ hasText: "Checking your access" })).toBeAttached();
  await expect(page.getByRole("heading", { level: 1, name: "Standards" })).toBeVisible();
  await expect.poll(() => sent, { timeout: 20_000 }).toEqual(["pass_slow"]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

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
