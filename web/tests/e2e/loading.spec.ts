import { expect, test } from "@playwright/test";

test("a page shows a loading shell, then the app replaces it", async ({ page }) => {
  let releaseWasm: () => void = () => {};
  const wasmHeld = new Promise<void>((resolve) => {
    releaseWasm = resolve;
  });
  await page.route(/_bg\.wasm$/, async (route) => {
    await wasmHeld;
    await route.continue();
  });

  await page.goto("/privacy", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("status").filter({ hasText: "Loading MeetCal…" })).toBeVisible();

  releaseWasm();
  await expect(page.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeVisible();
  await expect(page.locator("#app-loading")).toHaveCount(0);
});

for (const [name, pattern] of [
  ["Wasm binary", /_bg\.wasm$/],
  ["JavaScript loader", /\/meetcal-web-[0-9a-f]+\.js$/],
] as const) {
  test(`a ${name} that fails to load shows an error with a retry`, async ({ page }) => {
    await page.route(pattern, (route) => route.abort("internetdisconnected"));

    await page.goto("/standards");
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("MeetCal couldn’t load. Check your connection and try again.");
    await expect(alert.getByRole("button", { name: "Try again" })).toBeVisible();

    await page.unroute(pattern);
    await alert.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator("header.site-header")).toBeVisible();
    await expect(page.locator("#app-loading")).toHaveCount(0);
  });
}

test("a bootstrap that never loads still offers a reload", async ({ page }) => {
  // No script is left to report this failure, so the shell's CSS reveals a
  // plain reload link after a while.
  await page.route("**/app-bootstrap.js", (route) => route.abort("internetdisconnected"));
  await page.goto("/standards");
  const reload = page.getByRole("link", { name: "Reload the page" });
  await expect(reload).toBeHidden();
  await expect(reload).toBeVisible({ timeout: 15_000 });
  // Readable on the dark background too (the accent ink stays dark there).
  await expect(reload).toHaveCSS("color", await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--text)";
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }));

  await page.unroute("**/app-bootstrap.js");
  await reload.click();
  await expect(page).toHaveURL(/\/standards$/);
  await expect(page.locator("header.site-header")).toBeVisible();
  await expect(page.locator("#app-loading")).toHaveCount(0);
});

test("a bootstrap that reports its own error doesn't also offer the slow-load link", async ({ page }) => {
  await page.route(/_bg\.wasm$/, (route) => route.abort("internetdisconnected"));
  await page.goto("/standards");
  await expect(page.getByRole("alert").getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.locator(".app-loading-slow")).toBeHidden();
  await expect(page.locator(".app-loading-slow")).toHaveCSS("display", "none");
});
