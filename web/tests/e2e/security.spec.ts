import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const vercelConfig = JSON.parse(
  readFileSync(join(process.cwd(), "vercel.json"), "utf8"),
);
const contentSecurityPolicy = vercelConfig.headers
  .flatMap(({ headers }: { headers: Array<{ key: string; value: string }> }) => headers)
  .find(({ key }: { key: string }) => key === "Content-Security-Policy").value;

test("production CSP allows the Wasm app and authentication bootstrap", async ({ page }) => {
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.assign(window, { __meetcalCspViolations: violations });
    document.addEventListener("securitypolicyviolation", (event) => {
      violations.push(`${event.violatedDirective}: ${event.blockedURI}`);
    });
  });

  await page.addInitScript(() => {
    Object.assign(window, {
      __internal_ClerkUICtor: function ClerkUI() {},
      Clerk: {
        isSignedIn: false,
        user: null,
        load: async () => {},
        addListener: () => {},
        mountUserButton: () => {},
        unmountUserButton: () => {},
        mountSignIn: () => {},
        unmountSignIn: () => {},
        openSignIn: () => {},
      },
    });
  });

  await page.route("**/*", async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    if (route.request().resourceType() === "document") {
      // The local fixture is HTTP; production is already HTTPS, where this
      // directive has no URLs left to upgrade.
      headers["content-security-policy"] = contentSecurityPolicy.replace(
        "; upgrade-insecure-requests",
        "",
      );
    }
    await route.fulfill({ response, headers });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Your Competition Schedule, Simplified",
  );
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
  const violations = await page.evaluate(
    () => (window as typeof window & { __meetcalCspViolations: string[] }).__meetcalCspViolations,
  );
  expect(violations).toEqual([]);
});

test("an auth SDK file that fails its integrity check never runs", async ({ page }) => {
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.assign(window, { __meetcalCspViolations: violations });
    document.addEventListener("securitypolicyviolation", (event) => {
      violations.push(`${event.violatedDirective}: ${event.blockedURI}`);
    });
  });
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (/cdn\.jsdelivr\.net\/npm\/@clerk\//.test(url)) {
      // Served from the pinned URL, which the CSP allows, but not the pinned file.
      await route.fulfill({
        contentType: "application/javascript",
        headers: { "access-control-allow-origin": "*" },
        body: "window.__tampered = true; window.__internal_ClerkUICtor = function () {};",
      });
      return;
    }
    const response = await route.fetch();
    const headers = { ...response.headers() };
    if (route.request().resourceType() === "document") {
      headers["content-security-policy"] = contentSecurityPolicy.replace(
        "; upgrade-insecure-requests",
        "",
      );
    }
    await route.fulfill({ response, headers });
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeDisabled();
  const script = page.locator('script[src*="cdn.jsdelivr.net/npm/@clerk/ui@"]');
  await expect(script).toHaveAttribute("integrity", /^sha384-/);
  await expect(script).toHaveAttribute("crossorigin", "anonymous");
  expect(await page.evaluate(() => "__tampered" in window)).toBe(false);
  const violations = await page.evaluate(
    () => (window as typeof window & { __meetcalCspViolations: string[] }).__meetcalCspViolations,
  );
  expect(violations).toEqual([]);
});
