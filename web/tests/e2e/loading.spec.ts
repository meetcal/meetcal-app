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
