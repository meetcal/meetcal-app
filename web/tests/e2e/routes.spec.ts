import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { protectedDataRoutes, publicRoutes } from "./support/routes";

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
    await page.goto(path);
    await expect(page.locator("header.site-header")).toBeVisible();
    await expect(page.locator("footer.site-footer")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: /sign in to continue|couldn’t verify your access/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /choose plan|checkout|purchase/i })).toHaveCount(0);
  });
}

test("unknown routes render the not-found page", async ({ page }) => {
  await page.goto("/does-not-exist");
  await expect(page.getByRole("heading", { name: /not found/i })).toBeVisible();
});

test("subscription page only offers mobile-store handoffs", async ({ page }) => {
  await page.goto("/subscription");
  await expect(page.getByRole("link", { name: "Open on iPhone or iPad" })).toHaveAttribute("href", /apps\.apple\.com/);
  await expect(page.getByRole("link", { name: "Open on Android" })).toHaveAttribute("href", /play\.google\.com/);
  await expect(page.getByText(/created and managed only in the mobile app/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /choose plan|checkout|purchase/i })).toHaveCount(0);
  await expect(page.getByText(/secure checkout/i)).toHaveCount(0);
});

test("legal pages expose the declared privacy services and cross-link", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByText("Clerk, for authentication and account management.", { exact: true })).toBeVisible();
  await expect(page.getByText(/RevenueCat, Apple, and Google, for subscriptions/i)).toBeVisible();
  await expect(page.getByText("PostHog, for product analytics and diagnostics.", { exact: true })).toBeVisible();
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
    ["/qualifying-totals", /Weightlifting Qualifying Totals/, "noindex, nofollow"],
  ] as const;
  for (const [path, title, robots] of expectations) {
    await page.goto(path);
    await expect(page).toHaveTitle(title);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.{40,}/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", robots);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://meetcal.app${path}`);
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
