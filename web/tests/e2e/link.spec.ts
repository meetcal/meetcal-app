import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { errorAnswer, mockAuth, routeMutation, routeQuery, valueAnswer } from "./support/api";

// `/link` approves a `meetcal login` (convex/deviceLogin.ts): a signed-in
// user, no subscription, and three Convex calls that carry the session token.

type AuthMockState = {
  signInMounts: Array<Record<string, unknown>>;
  customerInfoCalls: number;
  setUser: (id: string | null) => void;
};

type Call = { args: Record<string, unknown>; authorization: string | undefined };

const MINUTE = 60_000;

/** A pending login, as `deviceLogin:describe` answers it. */
function pendingLogin(deviceName = "Maddisen’s MacBook Pro", requestedMinutesAgo = 2) {
  const createdAt = Date.now() - requestedMinutesAgo * MINUTE;
  return { deviceName, createdAt, expiresAt: createdAt + 10 * MINUTE };
}

/**
 * Mocks the three device-login calls. `describe` is what `deviceLogin:describe`
 * answers (the pending login, or `null`); `approve` and `deny` the status
 * `deviceLogin:approve` and `deviceLogin:deny` answer (200 or a function
 * error's status). Returns each function's calls.
 */
async function mockDeviceLogin(
  page: Page,
  { describe = pendingLogin() as ReturnType<typeof pendingLogin> | null, approve = 200, deny = 200 } = {},
) {
  const calls = { describe: [] as Call[], approve: [] as Call[], deny: [] as Call[] };
  const record = (list: Call[], args: Record<string, unknown>, authorization: string | undefined) =>
    list.push({ args, authorization });

  await routeQuery(page, "deviceLogin:describe", (route, args) => {
    record(calls.describe, args, route.request().headers().authorization);
    return route.fulfill(valueAnswer(describe));
  });
  await routeMutation(page, "deviceLogin:approve", (route, args) => {
    record(calls.approve, args, route.request().headers().authorization);
    if (approve !== 200) {
      return route.fulfill(errorAnswer("Server Error", { status: approve, error: "no pending login has that code" }));
    }
    return route.fulfill(valueAnswer({ ok: true }));
  });
  await routeMutation(page, "deviceLogin:deny", (route, args) => {
    record(calls.deny, args, route.request().headers().authorization);
    if (deny !== 200) {
      return route.fulfill(errorAnswer("Server Error", { status: deny, error: "this code has expired or was already used" }));
    }
    return route.fulfill(valueAnswer({ ok: true }));
  });
  return calls;
}

const authMock = (page: Page) =>
  page.evaluate(() => {
    const mock = (window as unknown as { __authMock: AuthMockState }).__authMock;
    return { signInMounts: mock.signInMounts, customerInfoCalls: mock.customerInfoCalls };
  });

const prompt = (page: Page) => page.getByRole("heading", { level: 1, name: "Sign in the MeetCal CLI?" });

test("signed out, the code waits behind the sign-in, which returns to it", async ({ page }) => {
  await mockAuth(page, { signedIn: false });
  const calls = await mockDeviceLogin(page);

  await page.goto("/link?code=WXYZ-BCDF");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to continue" })).toBeVisible();
  await expect.poll(async () => (await authMock(page)).signInMounts.length).toBeGreaterThan(0);
  const [options] = (await authMock(page)).signInMounts;
  expect(String(options.fallbackRedirectUrl)).toMatch(/\/link\?code=WXYZ-BCDF$/);
  expect(String(options.signUpFallbackRedirectUrl)).toMatch(/\/link\?code=WXYZ-BCDF$/);
  expect(calls.describe).toEqual([]);

  // Clerk signs the user in on this page.
  await page.evaluate(() => (window as unknown as { __authMock: AuthMockState }).__authMock.setUser("user_ci"));
  await expect(prompt(page)).toBeVisible();
  await expect(page.locator(".link-device")).toHaveText("Maddisen’s MacBook Pro");
  expect(calls.describe).toEqual([{ args: { userCode: "WXYZ-BCDF" }, authorization: "Bearer token_user_ci" }]);
  // No subscription is needed: RevenueCat is never asked.
  expect((await authMock(page)).customerInfoCalls).toBe(0);
});

test("a code in the link is looked up, approved, and done", async ({ page }) => {
  await mockAuth(page, { entitlements: [] });
  const calls = await mockDeviceLogin(page);

  // The CLI's link may come typed by hand: any case, no dash.
  await page.goto("/link?code=wxyzbcdf");
  await expect(prompt(page)).toBeVisible();
  await expect(page.locator(".link-device")).toHaveText("Maddisen’s MacBook Pro");
  // The name is the requester's own claim, and says so.
  await expect(page.locator(".link-details")).toContainText("“Maddisen’s MacBook Pro”");
  await expect(page.locator(".link-details")).toContainText("The name the device gave itself");
  await expect(page.locator(".link-details")).toContainText("WXYZ-BCDF");
  await expect(page.locator(".link-details")).toContainText("2 minutes ago");
  await expect(page.getByRole("note")).toContainText("Only approve if you just ran meetcal login yourself");
  expect(calls.describe.map(({ args }) => args)).toEqual([{ userCode: "WXYZ-BCDF" }]);

  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "CLI signed in" })).toBeVisible();
  await expect(page.getByText("Done — you can return to your terminal.")).toBeVisible();
  expect(calls.approve).toEqual([{ args: { userCode: "WXYZ-BCDF" }, authorization: "Bearer token_user_ci" }]);
  expect(calls.deny).toEqual([]);
  expect((await authMock(page)).customerInfoCalls).toBe(0);
});

test("deny tells the CLI no", async ({ page }) => {
  await mockAuth(page);
  const calls = await mockDeviceLogin(page);

  await page.goto("/link?code=WXYZ-BCDF");
  await expect(prompt(page)).toBeVisible();
  await page.getByRole("button", { name: "Deny" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Request denied" })).toBeVisible();
  expect(calls.deny).toEqual([{ args: { userCode: "WXYZ-BCDF" }, authorization: "Bearer token_user_ci" }]);
  expect(calls.approve).toEqual([]);
});

test("a deny the server turns down (404) shows the code expired or used, never denied", async ({ page }) => {
  await mockAuth(page);
  const calls = await mockDeviceLogin(page, { deny: 404 });

  await page.goto("/link?code=WXYZ-BCDF");
  await page.getByRole("button", { name: "Deny" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Code expired" })).toBeVisible();
  await expect(page.getByText("This code has expired or was already used, so it could not be denied.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Request denied" })).toHaveCount(0);
  await expect(page.getByText(/was not signed in/)).toHaveCount(0);
  expect(calls.deny).toHaveLength(1);
  // The way out: sign out the CLI logins.
  await expect(page.getByRole("button", { name: "Sign out all CLI logins" })).toBeVisible();
});

test("deny in one tab after another tab approved and the CLI took its token is not a denial", async ({ page }) => {
  // Convex's side: approve hands the CLI its token at once (it polls), so a
  // later deny has nothing left to turn down and answers 404.
  let collected = false;
  const mockServer = async (tab: Page) => {
    await mockAuth(tab);
    await routeQuery(tab, "deviceLogin:describe", (route) => route.fulfill(valueAnswer(pendingLogin())));
    await routeMutation(tab, "deviceLogin:approve", (route) => {
      collected = true;
      return route.fulfill(valueAnswer({ ok: true }));
    });
    await routeMutation(tab, "deviceLogin:deny", (route) =>
      route.fulfill(
        collected
          ? errorAnswer("Server Error", { status: 404, error: "this code has expired or was already used" })
          : valueAnswer({ ok: true }),
      ),
    );
  };
  await mockServer(page);
  const other = await page.context().newPage();
  await mockServer(other);

  await page.goto("/link?code=WXYZ-BCDF");
  await expect(prompt(page)).toBeVisible();
  await other.goto("/link?code=WXYZ-BCDF");
  await other.getByRole("button", { name: "Approve" }).click();
  await expect(other.getByRole("heading", { level: 1, name: "CLI signed in" })).toBeVisible();

  await page.getByRole("button", { name: "Deny" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Code expired" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Request denied" })).toHaveCount(0);
});

test("an unknown or expired code says to run meetcal login again", async ({ page }) => {
  await mockAuth(page);
  const calls = await mockDeviceLogin(page, { describe: null });

  await page.goto("/link?code=WXYZ-BCDF");
  await expect(page.getByRole("heading", { level: 1, name: "Code expired" })).toBeVisible();
  await expect(page.getByText("This code has expired or was already used. Run meetcal login again.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  expect(calls.approve).toEqual([]);

  await page.getByRole("link", { name: "Enter another code" }).click();
  await expect(page).toHaveURL(/\/link$/);
  await expect(page.getByRole("heading", { level: 1, name: "Enter your code" })).toBeVisible();
});

test("a code that expires before Approve says so", async ({ page }) => {
  await mockAuth(page);
  await mockDeviceLogin(page, { approve: 404 });

  await page.goto("/link?code=WXYZ-BCDF");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Code expired" })).toBeVisible();
});

test("a code typed by hand is formatted, checked, and looked up", async ({ page }) => {
  await mockAuth(page);
  const calls = await mockDeviceLogin(page);

  await page.goto("/link");
  await expect(page.getByRole("heading", { level: 1, name: "Enter your code" })).toBeVisible();
  const field = page.getByLabel("Code");

  await field.pressSequentially("wxy");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toHaveText("Enter all 8 letters of the code.");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  expect(calls.describe).toEqual([]);

  // A ninth character is dropped; the dash comes by itself. (Playwright puts
  // the caret at the start when it focuses a field; a tap puts it where tapped.)
  await field.press("End");
  await field.pressSequentially("z bcdfg");
  await expect(field).toHaveValue("WXYZ-BCDF");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await field.press("Enter");

  await expect(page).toHaveURL(/\/link\?code=WXYZ-BCDF$/);
  await expect(prompt(page)).toBeVisible();
  expect(calls.describe.map(({ args }) => args)).toEqual([{ userCode: "WXYZ-BCDF" }]);
});

test("a typo fixed in the middle of the code keeps the caret in place", async ({ page }) => {
  await mockAuth(page);
  await page.goto("/link");
  const field = page.getByLabel("Code");
  await field.fill("wxyzbcdf");
  await expect(field).toHaveValue("WXYZ-BCDF");
  // A letter typed after WX reformats the code; the caret stays after it.
  await field.evaluate((input: HTMLInputElement) => input.setSelectionRange(2, 2));
  await field.press("q");
  await expect(field).toHaveValue("WXQY-ZBCD");
  expect(await field.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(3);
});

test("part of a code in the link is put in the field to finish", async ({ page }) => {
  await mockAuth(page);
  const calls = await mockDeviceLogin(page);

  await page.goto("/link?code=wxyz-bc");
  await expect(page.getByRole("heading", { level: 1, name: "Enter your code" })).toBeVisible();
  await expect(page.getByLabel("Code")).toHaveValue("WXYZ-BC");
  expect(calls.describe).toEqual([]);
});

test("a failed lookup explains itself, and Try again looks again", async ({ page }) => {
  await mockAuth(page);
  let attempts = 0;
  await routeQuery(page, "deviceLogin:describe", (route) => {
    attempts += 1;
    return attempts === 1 ? route.abort("failed") : route.fulfill(valueAnswer(pendingLogin()));
  });

  await page.goto("/link?code=WXYZ-BCDF");
  await expect(page.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(/couldn't be reached|offline/);
  await expect(page.getByRole("alert")).not.toContainText("deviceLogin");

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(prompt(page)).toBeVisible();
  expect(attempts).toBe(2);
});

test("a failed approval keeps the request, and Try again approves again", async ({ page }) => {
  await mockAuth(page);
  await routeQuery(page, "deviceLogin:describe", (route) => route.fulfill(valueAnswer(pendingLogin())));
  let approvals = 0;
  await routeMutation(page, "deviceLogin:approve", (route) => {
    approvals += 1;
    return approvals === 1 ? route.abort("failed") : route.fulfill(valueAnswer({ ok: true }));
  });

  await page.goto("/link?code=WXYZ-BCDF");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeVisible();
  // Not retried by itself: a mutation goes again only when the user asks.
  expect(approvals).toBe(1);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "CLI signed in" })).toBeVisible();
  expect(approvals).toBe(2);
});

test("the request fits a small phone, with full-width touch targets", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Mobile-only layout assertion");
  await mockAuth(page);
  await mockDeviceLogin(page, { describe: pendingLogin(`Claude Code on ${"a-very-long-hostname-".repeat(6)}`) });
  await page.setViewportSize({ width: 320, height: 640 });

  await page.goto("/link?code=WXYZ-BCDF");
  await expect(prompt(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
  const actions = await page.locator(".link-actions").boundingBox();
  for (const name of ["Approve", "Deny"]) {
    const box = await page.getByRole("button", { name }).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual((actions?.width ?? 0) - 1);
  }
  // The device name is the CLI's to choose: it is cut short, never the page.
  expect((await page.locator(".link-device").textContent())?.length).toBeLessThanOrEqual(60);
});

test("the request and the code entry have no serious accessibility violations", async ({ page }) => {
  await mockAuth(page);
  await mockDeviceLogin(page);
  for (const [path, heading] of [
    ["/link?code=WXYZ-BCDF", "Sign in the MeetCal CLI?"],
    ["/link", "Enter your code"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const material = results.violations.filter(({ impact }) => impact === "serious" || impact === "critical");
    expect(material, `${path} accessibility violations`).toEqual([]);
  }
});

/** Mocks `apiTokens:revokeAllCli`; `answer` handles each call (default `{ ended: 2 }`). Returns the calls. */
async function mockRevokeAll(page: Page, answer?: (call: number) => "fail" | number) {
  const calls: Call[] = [];
  await routeMutation(page, "apiTokens:revokeAllCli", (route, args) => {
    calls.push({ args, authorization: route.request().headers().authorization });
    const result = answer ? answer(calls.length) : 2;
    return result === "fail" ? route.abort("failed") : route.fulfill(valueAnswer({ ended: result }));
  });
  return calls;
}

test("sign out all CLI logins asks first, then says how many ended", async ({ page }) => {
  await mockAuth(page);
  await mockDeviceLogin(page);
  const calls = await mockRevokeAll(page);

  await page.goto("/link?code=WXYZ-BCDF");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "CLI signed in" })).toBeVisible();

  // Offered in the done state too; Cancel sends nothing.
  await page.getByRole("button", { name: "Sign out all CLI logins" }).click();
  await expect(page.getByText("Sign out every computer signed in with meetcal login?")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(calls).toEqual([]);

  await page.getByRole("button", { name: "Sign out all CLI logins" }).click();
  await page.getByRole("button", { name: "Sign out all", exact: true }).click();
  await expect(page.getByText("Signed out 2 CLI logins.")).toBeVisible();
  expect(calls).toEqual([{ args: {}, authorization: "Bearer token_user_ci" }]);
});

test("a failed sign-out of CLI logins is not sent again until Try again", async ({ page }) => {
  await mockAuth(page);
  const calls = await mockRevokeAll(page, (call) => (call === 1 ? "fail" : 1));

  await page.goto("/link");
  await expect(page.getByRole("heading", { level: 1, name: "Enter your code" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out all CLI logins" }).click();
  await page.getByRole("button", { name: "Sign out all", exact: true }).click();
  await expect(page.locator(".link-revoke [role=alert]")).toContainText(/couldn't be reached|offline/);
  expect(calls).toHaveLength(1);

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Signed out 1 CLI login.")).toBeVisible();
  expect(calls).toHaveLength(2);
});

test("signed out, there is no sign-out of CLI logins to offer", async ({ page }) => {
  await mockAuth(page, { signedIn: false });
  await page.goto("/link?code=WXYZ-BCDF");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to continue" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out all CLI logins" })).toHaveCount(0);
});
