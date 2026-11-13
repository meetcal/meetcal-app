import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const config = JSON.parse(
  await readFile(new URL("../../vercel.json", import.meta.url), "utf8"),
);

test("the Android app's User Agreement link (/eula) reaches the Terms of Use", () => {
  assert.deepEqual(config.redirects.find(({ source }) => source === "/eula"), {
    source: "/eula",
    destination: "/terms",
    permanent: false,
  });
  assert.ok(config.rewrites.some(({ source }) => source === "/terms"));
});

test("trailing-slash URLs redirect to the route without one", () => {
  assert.equal(config.trailingSlash, false);
});

test("unknown URLs get a noindex 404 document that boots the app", async () => {
  const html = await readFile(new URL("../../dist/404.html", import.meta.url), "utf8");
  assert.match(html, /<title>Page Not Found — MeetCal<\/title>/);
  assert.match(html, /<meta id="meta-robots" name="robots" content="noindex, nofollow"/);
  assert.doesNotMatch(html, /rel="canonical"/);
  assert.match(html, /<script type="module" src="\/app-bootstrap-[0-9a-f]{16}\.js"><\/script>/);
  // Asset URLs must be absolute: the 404 is served at any depth (/a/b/c).
  assert.doesNotMatch(html, /(?:href|src)="(?!\/|https?:|data:|mailto:)[^"#]/);
});

test("canonical URLs, the sitemap and robots.txt name www.meetcal.app", async () => {
  const features = await readFile(new URL("../../dist/seo/features.html", import.meta.url), "utf8");
  assert.match(features, /<link id="canonical-url" rel="canonical" href="https:\/\/www\.meetcal\.app\/features"/);
  assert.match(features, /property="og:url" content="https:\/\/www\.meetcal\.app\/features"/);

  const sitemap = await readFile(new URL("../../public/sitemap.xml", import.meta.url), "utf8");
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url);
  assert.ok(locations.length > 0);
  for (const url of locations) assert.match(url, /^https:\/\/www\.meetcal\.app\//);
  // `/link` approves a CLI sign-in: noindex, and never listed.
  assert.ok(!locations.some((url) => url.includes("/link")), "the sitemap lists /link");

  const robots = await readFile(new URL("../../public/robots.txt", import.meta.url), "utf8");
  assert.match(robots, /^Sitemap: https:\/\/www\.meetcal\.app\/sitemap\.xml$/m);
});

test("the browser tests' server serves the Schedule Builder its own app, as Vercel does", async () => {
  const serve = JSON.parse(await readFile(new URL("../serve.json", import.meta.url), "utf8"));
  assert.deepEqual(
    serve.rewrites.find(({ destination }) => destination === "/seo/schedule-builder.html"),
    config.rewrites.find(({ source }) => source === "/schedule-builder"),
  );
  const playwright = await readFile(new URL("../../playwright.config.ts", import.meta.url), "utf8");
  assert.match(playwright, /command: "npx serve dist -l 4173 -c \.\.\/tests\/serve\.json"/);
});

test("the browser tests' server sends every site path to the site's app and assets as they are", async (t) => {
  const serve = JSON.parse(await readFile(new URL("../serve.json", import.meta.url), "utf8"));
  const dist = await mkdtemp(join(tmpdir(), "meetcal-serve-"));
  t.after(() => rm(dist, { recursive: true, force: true }));
  await mkdir(join(dist, "seo"));
  const files = {
    "index.html": "site index",
    "404.html": "not found",
    "seo/schedule-builder.html": "schedule builder",
    "meetcal-web-0123456789abcdef_bg.wasm": "site wasm",
  };
  for (const [path, body] of Object.entries(files)) await writeFile(join(dist, path), body);

  const serveHandler = createRequire(createRequire(import.meta.url).resolve("serve/package.json"))("serve-handler");
  const server = createServer((request, response) => serveHandler(request, response, { ...serve, public: dist }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const expected = {
    "/": "site index",
    "/records": "site index",
    "/features": "site index",
    "/comp-data": "site index",
    "/link": "site index",
    "/nope/deep": "site index",
    "/schedule-builder": "schedule builder",
    "/meetcal-web-0123456789abcdef_bg.wasm": "site wasm",
  };
  for (const [path, body] of Object.entries(expected)) {
    const response = await fetch(`${origin}${path}`);
    assert.deepEqual([response.status, await response.text()], [200, body], path);
  }
  const missingAsset = await fetch(`${origin}/missing.js`);
  assert.deepEqual([missingAsset.status, await missingAsset.text()], [404, "not found"]);
});
