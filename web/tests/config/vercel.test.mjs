import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const config = JSON.parse(
  await readFile(new URL("../../vercel.json", import.meta.url), "utf8"),
);
const globalHeaders = Object.fromEntries(
  config.headers
    .find(({ source }) => source === "/(.*)")
    .headers.map(({ key, value }) => [key.toLowerCase(), value]),
);

test("production responses enforce HTTPS and a restrictive CSP", () => {
  assert.match(globalHeaders["strict-transport-security"], /max-age=31536000/);

  const csp = globalHeaders["content-security-policy"];
  for (const directive of [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
  ]) {
    assert.ok(csp.includes(directive), `missing CSP directive: ${directive}`);
  }
  assert.ok(!csp.includes("'unsafe-eval'"), "CSP must not allow general JavaScript eval");
});

test("CSP preserves the application's existing provider integrations", () => {
  const csp = globalHeaders["content-security-policy"];
  for (const source of [
    "'wasm-unsafe-eval'",
    "https://*.clerk.accounts.dev",
    "https://api.revenuecat.com",
    "https://e.revenue.cat",
    "https://*.posthog.com",
  ]) {
    assert.ok(csp.includes(source), `missing required CSP source: ${source}`);
  }

  const connectSrc = csp
    .split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith("connect-src "));
  for (const source of [
    "https://clerk.meetcal.app",
    "https://disciplined-hare-790.convex.cloud",
    "https://api.revenuecat.com",
  ]) {
    assert.ok(
      connectSrc.includes(source),
      `connect-src must allow the production API host: ${source}`,
    );
  }
});

test("the source document uses an external Wasm bootstrap", async () => {
  const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
  assert.match(html, /<script type="module" src="\/app-bootstrap\.js"><\/script>/);
  assert.doesNotMatch(html, /<script type="module">/);
});

test("the Atlas page lives on atlas.meetcal.app, behind a permanent redirect", () => {
  assert.deepEqual(
    config.redirects.find(({ source }) => source === "/atlas"),
    { source: "/atlas", destination: "https://atlas.meetcal.app/", permanent: true },
  );
  assert.equal(config.rewrites.find(({ source }) => source === "/atlas"), undefined);
});

test("production rewrites serve route-specific metadata shells", async () => {
  const featureRewrite = config.rewrites.find(({ source }) => source === "/features");
  assert.equal(featureRewrite.destination, "/seo/features.html");

  const featureHtml = await readFile(
    new URL("../../dist/seo/features.html", import.meta.url),
    "utf8",
  );
  assert.match(featureHtml, /<title>MeetCal Features/);
  assert.match(featureHtml, /content="index, follow"/);
  assert.match(featureHtml, /href="https:\/\/www\.meetcal\.app\/features"/);

  const gatedHtml = await readFile(
    new URL("../../dist/seo/qualifying-totals.html", import.meta.url),
    "utf8",
  );
  assert.match(gatedHtml, /<title>Weightlifting Qualifying Totals<\/title>/);
  assert.match(gatedHtml, /content="noindex, nofollow"/);

  for (const route of ["meet-center", "club-dashboard", "wso-dashboard", "link", "submit-meet"]) {
    const rewrite = config.rewrites.find(({ source }) => source === `/${route}`);
    assert.equal(rewrite.destination, `/seo/${route}.html`);
    const html = await readFile(new URL(`../../dist/seo/${route}.html`, import.meta.url), "utf8");
    assert.match(html, /content="noindex, nofollow"/);
    assert.match(html, new RegExp(`href="https:\\/\\/www\\.meetcal\\.app\\/${route}"`));
  }

  // Athlete Wrapped is free: its shell is indexable and describes the page.
  assert.equal(config.rewrites.find(({ source }) => source === "/wrapped").destination, "/seo/wrapped.html");
  const wrappedHtml = await readFile(new URL("../../dist/seo/wrapped.html", import.meta.url), "utf8");
  assert.match(wrappedHtml, /<title>Weightlifting Athlete Wrapped<\/title>/);
  assert.match(wrappedHtml, /content="index, follow"/);
  assert.match(wrappedHtml, /name="description"\s+content="Free Weightlifting Wrapped: /);
  assert.doesNotMatch(wrappedHtml, /Sign in with your MeetCal account/);
});

test("every deployment reads Convex directly, with no API proxy", () => {
  // Convex answers any origin, so previews need no same-origin rewrite (see
  // src/utils/api.rs), and the retired Rust API is not reachable.
  assert.equal(config.rewrites.find(({ source }) => source.startsWith("/api")), undefined);
  assert.ok(
    !globalHeaders["content-security-policy"].includes("api.meetcal.app"),
    "CSP must not allow the retired Rust API",
  );
});

test("script-src allows only the pinned SDK versions, which load with SRI", async () => {
  const bridge = await readFile(new URL("../../src/auth_bridge.js", import.meta.url), "utf8");
  const constant = (name) => bridge.match(new RegExp(`const ${name} = "([^"]+)";`))?.[1];
  const scriptSrc = globalHeaders["content-security-policy"]
    .split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith("script-src "))
    .split(" ")
    .slice(1);

  const pinned = [
    ["CLERK_UI", "https://cdn.jsdelivr.net/npm/@clerk/ui@"],
    ["CLERK_JS", "https://cdn.jsdelivr.net/npm/@clerk/clerk-js@"],
    ["REVENUECAT_JS", "https://unpkg.com/@revenuecat/purchases-js@"],
  ];
  for (const [name, prefix] of pinned) {
    const version = constant(`${name}_VERSION`);
    assert.match(version ?? "", /^\d+\.\d+\.\d+$/, `${name}_VERSION`);
    assert.ok(scriptSrc.includes(`${prefix}${version}/`), `script-src must allow ${prefix}${version}/`);
    assert.match(constant(`${name}_INTEGRITY`) ?? "", /^sha384-[A-Za-z0-9+/]{64}$/, `${name}_INTEGRITY`);
  }
  assert.equal((bridge.match(/integrity: [A-Z_]+_INTEGRITY/g) ?? []).length, pinned.length);

  // No whole CDN host: anything published there could otherwise run here.
  for (const host of ["https://cdn.jsdelivr.net", "https://unpkg.com"]) {
    assert.ok(!scriptSrc.includes(host) && !scriptSrc.includes(`${host}/`), `script-src allows all of ${host}`);
  }
  for (const source of scriptSrc.filter((source) => /jsdelivr|unpkg/.test(source))) {
    assert.ok(pinned.some(([name, prefix]) => source === `${prefix}${constant(`${name}_VERSION`)}/`), source);
  }
});
