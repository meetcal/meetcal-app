import { expect, test } from "@playwright/test";

test("header and home hero visual baseline", async ({ page }) => {
  await page.route(/cdn\.jsdelivr\.net\/npm\/@clerk\//, async (route) => route.abort());
  await page.goto("/");
  await expect(page.locator("header.site-header")).toBeVisible();

  await expect(page.locator("header.site-header")).toHaveScreenshot("site-header.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.1,
  });
  await expect(page.locator(".hero-section")).toHaveScreenshot("home-hero.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.1,
  });
});

test("mobile subscription handoff visual baseline", async ({ page }) => {
  await page.goto("/subscription");
  await expect(page.locator(".access-card")).toBeVisible();

  await expect(page.locator(".access-card")).toHaveScreenshot("subscription-card.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.1,
  });
});
