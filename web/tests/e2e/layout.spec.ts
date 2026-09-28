import { expect, test } from "@playwright/test";
import { jsonResponse, mockSubscribedUser } from "./support/api";
import { publicRoutes } from "./support/routes";

test("desktop navigation remains visible and complete", async ({ page, isMobile }) => {
  test.skip(isMobile, "Desktop-only navigation assertion");
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await expect(page.locator("details.mobile-nav")).toBeHidden();
  await expect(page.getByRole("link", { name: "Competition Data" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Products" }).focus();
  await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "War Games" })).toHaveAttribute("href", "https://wargames.meetcal.app");
  await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Atlas" })).toBeVisible();
});

test("mobile navigation opens and supports internal navigation", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Mobile-only navigation assertion");
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeHidden();
  const menu = page.locator("details.mobile-nav");
  await menu.locator("summary").click();
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "War Games" })).toHaveAttribute("href", "https://wargames.meetcal.app");
  await expect(page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "Atlas" })).toHaveAttribute("href", "/atlas");
  await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "Features" }).click();
  await expect(page).toHaveURL(/\/features$/);
  await expect(page.getByRole("heading", { level: 1, name: "Everything you need before the bar is loaded" })).toBeVisible();
  await expect(page.locator("details.mobile-nav")).not.toHaveAttribute("open", "");
});

test("mobile pages and key containers stay within the viewport", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Mobile-only layout assertion");
  for (const [path] of publicRoutes) {
    await page.goto(path);
    const layout = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      const selectors = [".site-header", ".hero-section", ".features-page", ".access-card", "main main", ".site-footer"];
      const boxes = selectors.flatMap((selector) =>
        [...document.querySelectorAll<HTMLElement>(selector)]
          .filter((element) => element.offsetParent !== null)
          .map((element) => ({ selector, ...element.getBoundingClientRect().toJSON() })),
      );
      return { viewport, scrollWidth: document.documentElement.scrollWidth, offenders: boxes.filter(({ left, right }) => left < -1 || right > viewport + 1) };
    });
    expect(layout.scrollWidth, `${path} page width`).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.offenders, `${path} overflowing containers`).toEqual([]);
  }
});

test("mobile subscription actions are full-width touch targets", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Mobile-only layout assertion");
  await page.goto("/subscription");
  const links = page.locator(".mobile-subscription-links .access-button");
  await expect(links).toHaveCount(2);
  const container = await page.locator(".mobile-subscription-links").boundingBox();
  for (const link of await links.all()) {
    const box = await link.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual((container?.width ?? 0) - 1);
  }
});

test("authenticated mobile headers fit at narrow widths", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Mobile-only authenticated layout assertion");
  await mockSubscribedUser(page);
  await page.route("**/data/qualifying-totals", async (route) => route.fulfill(jsonResponse([])));
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/qualifying-totals");
  await expect(page.getByRole("heading", { name: "Qualifying Totals" })).toBeVisible();
  await expect(page.locator(".clerk-user-button")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
});

test("mobile layouts tolerate landscape and enlarged text", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Mobile-only responsive layout assertion");
  await page.setViewportSize({ width: 568, height: 320 });
  await page.goto("/features");
  await page.addStyleTag({ content: "html { font-size: 125%; }" });
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.viewport + 1);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("competition loading and error states stay contained", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Mobile-only data-state layout assertion");
  await mockSubscribedUser(page);
  await page.route("**/data/qualifying-totals", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    // A 500 fails without retries; throttled and overloaded responses are
    // retried and covered in competition.spec.ts.
    await route.fulfill({ status: 500, ...jsonResponse({ error: "unavailable" }) });
  });
  await page.goto("/qualifying-totals");
  await expect(page.locator(".data-table-skeleton")).toBeVisible();
  await expect(page.getByText(/could not load qualifying totals/i)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth + 1));
});
