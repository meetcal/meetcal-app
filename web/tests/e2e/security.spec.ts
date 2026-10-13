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
    // The bridge removes a script element that failed, so record each SDK
    // script's attributes as it is added.
    const scripts: Array<{ src: string; integrity: string | null; crossorigin: string | null }> = [];
    Object.assign(window, { __meetcalCspViolations: violations, __meetcalScripts: scripts });
    document.addEventListener("securitypolicyviolation", (event) => {
      violations.push(`${event.violatedDirective}: ${event.blockedURI}`);
    });
    new MutationObserver((mutations) => {
      for (const node of mutations.flatMap((mutation) => [...mutation.addedNodes])) {
        if (node instanceof HTMLScriptElement && node.src) {
          scripts.push({ src: node.src, integrity: node.getAttribute("integrity"), crossorigin: node.getAttribute("crossorigin") });
        }
      }
    }).observe(document, { childList: true, subtree: true });
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
  const scripts = await page.evaluate(
    () => (window as typeof window & { __meetcalScripts: Array<Record<string, string | null>> }).__meetcalScripts,
  );
  const clerkUi = scripts.find(({ src }) => src?.includes("cdn.jsdelivr.net/npm/@clerk/ui@"));
  expect(clerkUi?.integrity).toMatch(/^sha384-/);
  expect(clerkUi?.crossorigin).toBe("anonymous");
  // The refused element is gone, so a later load starts afresh.
  await expect(page.locator('script[src*="cdn.jsdelivr.net/npm/@clerk/ui@"]')).toHaveCount(0);
  expect(await page.evaluate(() => "__tampered" in window)).toBe(false);
  const violations = await page.evaluate(
    () => (window as typeof window & { __meetcalCspViolations: string[] }).__meetcalCspViolations,
  );
  expect(violations).toEqual([]);
});

test("a subscription SDK that fails its integrity check fails every check, not just the first", async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      __internal_ClerkUICtor: function ClerkUI() {},
      Clerk: {
        isSignedIn: true,
        user: { id: "user_ci" },
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
  await page.route(/unpkg\.com\/@revenuecat\/purchases-js@/, async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      headers: { "access-control-allow-origin": "*" },
      body: "window.__tampered = true;",
    });
  });

  await page.goto("/results");
  const failure = page.getByRole("heading", { name: "We couldn’t verify your access" });
  await expect(failure).toBeVisible();
  expect(await page.evaluate(() => "__tampered" in window)).toBe(false);

  // The next data page checks again in the same document; it must fail too,
  // not wait on the first, refused script element.
  await page.evaluate(() => {
    history.pushState({}, "", "/rankings");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL(/\/rankings$/);
  await expect(failure).toBeVisible();
  await expect(page.getByRole("heading", { name: "Checking your access" })).toHaveCount(0);
  await expect(page.locator('script[src*="unpkg.com/@revenuecat/"]')).toHaveCount(0);
});
