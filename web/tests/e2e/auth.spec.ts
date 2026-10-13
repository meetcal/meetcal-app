import { expect, test } from "@playwright/test";
import { mockSubscribedUser } from "./support/api";

for (const colorScheme of ["light", "dark"] as const) {
  test(`the signed-in user's name is readable in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await mockSubscribedUser(page);
    await page.goto("/");
    await expect(page.locator(".clerk-user-button")).toHaveText("Test User");

    // Clerk renders the name with the color the bridge passes it.
    const color = await page.evaluate(() => {
      const options = (window as typeof window & {
        __userButtonOptions?: { appearance?: { elements?: Record<string, { color?: string }> } };
      }).__userButtonOptions;
      return options?.appearance?.elements?.userButtonOuterIdentifier?.color;
    });
    expect(color).toBe("var(--text)");

    const { text, background } = await page.locator("header.site-header").evaluate((header) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--text)";
      header.appendChild(probe);
      const text = getComputedStyle(probe).color;
      probe.remove();
      return { text, background: getComputedStyle(document.body).backgroundColor };
    });
    const luminance = (rgb: string) => {
      const [r, g, b] = rgb.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number).map((channel) => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [lighter, darker] = [luminance(text), luminance(background)].sort((a, b) => b - a);
    expect((lighter + 0.05) / (darker + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
}
