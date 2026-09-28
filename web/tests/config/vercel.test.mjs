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
    "https://cdn.jsdelivr.net",
    "https://unpkg.com",
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
    "https://api.meetcal.app",
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

test("production rewrites serve route-specific metadata shells", async () => {
  const atlasRewrite = config.rewrites.find(({ source }) => source === "/atlas");
  assert.equal(atlasRewrite.destination, "/seo/atlas.html");

  const atlasHtml = await readFile(new URL("../../dist/seo/atlas.html", import.meta.url), "utf8");
  assert.match(atlasHtml, /<title>Atlas — Weightlifting Coaching Platform/);
  assert.match(atlasHtml, /href="https:\/\/meetcal\.app\/atlas"/);

  const featureRewrite = config.rewrites.find(({ source }) => source === "/features");
  assert.equal(featureRewrite.destination, "/seo/features.html");

  const featureHtml = await readFile(
    new URL("../../dist/seo/features.html", import.meta.url),
    "utf8",
  );
  assert.match(featureHtml, /<title>MeetCal Features/);
  assert.match(featureHtml, /content="index, follow"/);
  assert.match(featureHtml, /href="https:\/\/meetcal\.app\/features"/);

  const gatedHtml = await readFile(
    new URL("../../dist/seo/qualifying-totals.html", import.meta.url),
    "utf8",
  );
  assert.match(gatedHtml, /<title>Weightlifting Qualifying Totals<\/title>/);
  assert.match(gatedHtml, /content="noindex, nofollow"/);

  for (const route of ["meet-center", "club-dashboard", "wso-dashboard", "wrapped"]) {
    const rewrite = config.rewrites.find(({ source }) => source === `/${route}`);
    assert.equal(rewrite.destination, `/seo/${route}.html`);
    const html = await readFile(new URL(`../../dist/seo/${route}.html`, import.meta.url), "utf8");
    assert.match(html, /content="noindex, nofollow"/);
    assert.match(html, new RegExp(`href="https:\\/\\/meetcal\\.app\\/${route}"`));
  }
});

test("preview deployments keep the same-origin API rewrite", () => {
  // Production origins call https://api.meetcal.app directly (see
  // src/utils/api.rs); other Vercel origins, which the API's CORS policy
  // rejects, still proxy through /api.
  const apiRewrite = config.rewrites.find(({ source }) => source === "/api/:path*");
  assert.equal(apiRewrite?.destination, "https://api.meetcal.app/:path*");
});
