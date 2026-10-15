import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mockAuth } from "./support/api";
import { protectedDataRoutes, publicRoutes, signedInRoutes } from "./support/routes";

for (const [path, heading] of publicRoutes) {
  test(`${path} renders its primary content`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.locator("header.site-header")).toBeVisible();
    await expect(page.locator("footer.site-footer")).toBeVisible();
  });
}

for (const path of protectedDataRoutes) {
  test(`${path} deep link reaches the subscription gate`, async ({ page }) => {
    await mockAuth(page, { signedIn: false });
    await page.goto(path);
    await expect(page.locator("header.site-header")).toBeVisible();
    await expect(page.locator("footer.site-footer")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Sign in to continue" })).toBeVisible();
    await expect(page.getByRole("button", { name: /choose plan|checkout|purchase/i })).toHaveCount(0);
  });
}

for (const [path, heading] of signedInRoutes) {
  test(`${path} asks a signed-out visitor to sign in, without the subscription gate`, async ({ page }) => {
    await mockAuth(page, { signedIn: false });
    await page.goto(path);
    await expect(page.locator("header.site-header")).toBeVisible();
    await expect(page.locator("footer.site-footer")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText(/subscription-only/i)).toHaveCount(0);
  });

  test(`${path} is kept out of the site navigation`, async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(`header a[href^="${path}"], footer a[href^="${path}"]`)).toHaveCount(0);
  });
}

test("unknown routes render the not-found page", async ({ page }) => {
  await page.goto("/does-not-exist");
  await expect(page.getByRole("heading", { name: /not found/i })).toBeVisible();
  await expect(page.locator("header.site-header")).toBeVisible();
  await page.getByRole("link", { name: "Browse competition data" }).click();
  await expect(page).toHaveURL(/\/comp-data$/);
  await page.goto("/does-not-exist");
  await page.getByRole("link", { name: "Go to the home page" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your Competition Schedule, Simplified" })).toBeVisible();
});

test("the canonical link follows navigation into and out of the Not Found page", async ({ page }) => {
  // Vercel answers a missing path with dist/404.html, whose shell has no
  // canonical link; the static test server would answer with index.html.
  await page.route("**/does-not-exist", (route) =>
    route.fulfill({ status: 404, contentType: "text/html", path: "dist/404.html" }),
  );
  const canonical = page.locator('link[rel="canonical"]');
  await page.goto("/does-not-exist");
  await expect(page.getByRole("heading", { name: /not found/i })).toBeVisible();
  await expect(canonical).toHaveCount(0);

  await page.getByRole("link", { name: "Go to the home page" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your Competition Schedule, Simplified" })).toBeVisible();
  await expect(canonical).toHaveCount(1);
  await expect(canonical).toHaveAttribute("href", "https://www.meetcal.app/");

  await page.goBack();
  await expect(page.getByRole("heading", { name: /not found/i })).toBeVisible();
  await expect(canonical).toHaveCount(0);

  await page.goForward();
  await expect(canonical).toHaveAttribute("href", "https://www.meetcal.app/");
});

test("subscription page only offers mobile-store handoffs", async ({ page }) => {
  await page.goto("/subscription");
  await expect(page.getByRole("link", { name: "Open on iPhone or iPad" })).toHaveAttribute("href", /apps\.apple\.com/);
  await expect(page.getByRole("link", { name: "Open on Android" })).toHaveAttribute("href", /play\.google\.com/);
  await expect(page.getByText(/created and managed only in the mobile app/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /choose plan|checkout|purchase/i })).toHaveCount(0);
  await expect(page.getByText(/secure checkout/i)).toHaveCount(0);
  // The app has no Settings screen: subscriptions are managed from My Profile.
  await expect(page.getByText(/open My Profile, then Customer Support/i)).toBeVisible();
  await expect(page.getByText(/open Settings/i)).toHaveCount(0);
});

test("every app download link offers both the App Store and Google Play", async ({ page }) => {
  await page.goto("/");
  const footer = page.locator("footer.site-footer");
  await expect(footer.getByRole("link", { name: "Download for iOS" })).toHaveAttribute("href", /apps\.apple\.com/);
  await expect(footer.getByRole("link", { name: "Download for Android" })).toHaveAttribute("href", /play\.google\.com/);
  const appCard = page.locator(".interaction-card").filter({ hasText: "The app" });
  await expect(appCard.getByRole("link", { name: /iPhone or iPad/ })).toHaveAttribute("href", /apps\.apple\.com/);
  await expect(appCard.getByRole("link", { name: /Android/ })).toHaveAttribute("href", /play\.google\.com/);
});

test("the CLI card's Cargo command installs a release from this repository", async ({ page }) => {
  await page.goto("/");
  // The tag moves with each CLI release; the Rust test in `pages/home.rs` keeps it equal to `cli/README.md`.
  await expect(page.locator(".cli-command code").filter({ hasText: "cargo install" })).toHaveText(
    /^cargo install --locked --git https:\/\/github\.com\/meetcal\/meetcal-app\.git --tag cli-v\d+\.\d+\.\d+ meetcal$/,
  );
});

test("legal pages expose the declared privacy services and cross-link", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByText("Clerk, for authentication and account management.", { exact: true })).toBeVisible();
  await expect(page.getByText(/RevenueCat, Apple, and Google, for subscriptions/i)).toBeVisible();
  await expect(page.getByText("PostHog, for product analytics and diagnostics.", { exact: true })).toBeVisible();
  await expect(page.getByText("OneSignal, for push notifications and in-app messages.", { exact: true })).toBeVisible();
  await expect(page.getByText("Sentry, for crash and error diagnostics.", { exact: true })).toBeVisible();
  await expect(page.getByText(/asks for permission to send notifications/i)).toBeVisible();
  await expect(page.getByText(/open My Profile, then Delete Your Account/i)).toBeVisible();
  await expect(page.getByText(/only through the MeetCal mobile app/i)).toBeVisible();
  await expect(page.getByText(/does not currently provide a separate analytics preference control/i)).toBeVisible();
  await expect(page.getByText(/manage analytics through available browser or device controls/i)).toHaveCount(0);
  await page.goto("/terms");
  await page.getByRole("link", { name: "Privacy Policy" }).first().click();
  await expect(page).toHaveURL(/\/privacy$/);
});

test("routes expose specific titles, descriptions, canonicals, and indexing rules", async ({ page }) => {
  const expectations = [
    ["/", /Weightlifting Meet Schedules/, "index, follow"],
    ["/features", /MeetCal Features/, "index, follow"],
    ["/privacy", /Privacy Policy/, "index, follow"],
    ["/terms", /Terms of Use/, "index, follow"],
    ["/subscription", /Manage Your MeetCal Subscription/, "noindex, nofollow"],
    ["/link", /Approve a MeetCal CLI Sign-In/, "noindex, nofollow"],
    ["/wrapped", /Weightlifting Athlete Wrapped/, "index, follow"],
    ["/qualifying-totals", /Weightlifting Qualifying Totals/, "noindex, nofollow"],
  ] as const;
  for (const [path, title, robots] of expectations) {
    await page.goto(path);
    await expect(page).toHaveTitle(title);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.{40,}/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", robots);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://www.meetcal.app${path}`);
  }
  await page.goto("/does-not-exist");
  await expect(page).toHaveTitle(/Page Not Found/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
});

test("footer uses valid, non-nested interactive links", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("a button, button a")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Legal" })).toBeVisible();
  await expect(page.locator('a[target="_blank"]:not([rel~="noopener"])')).toHaveCount(0);
});

test("public pages have no serious or critical accessibility violations", async ({ page }) => {
  for (const [path] of publicRoutes) {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const materialViolations = results.violations.filter(({ impact }) => impact === "serious" || impact === "critical");
    expect(materialViolations, `${path} accessibility violations`).toEqual([]);
  }
});

test("every page has one top-level banner, main and contentinfo landmark", async ({ page }) => {
  for (const path of [...publicRoutes.map(([path]) => path), "/qualifying-totals", "/does-not-exist"]) {
    await page.goto(path);
    await expect(page.locator("header.site-header")).toBeVisible();
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("main header, main footer, main main")).toHaveCount(0);
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("contentinfo")).toHaveCount(1);
    const results = await new AxeBuilder({ page })
      .withRules([
        "landmark-main-is-top-level",
        "landmark-no-duplicate-main",
        "landmark-one-main",
        "landmark-banner-is-top-level",
        "landmark-contentinfo-is-top-level",
        "landmark-no-duplicate-banner",
        "landmark-no-duplicate-contentinfo",
      ])
      .analyze();
    expect(results.violations, `${path} landmark violations`).toEqual([]);
  }
});
