import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  assert.match(html, /<script type="module" src="\/app-bootstrap\.js"><\/script>/);
  // Asset URLs must be absolute: the 404 is served at any depth (/a/b/c).
  assert.doesNotMatch(html, /(?:href|src)="(?!\/|https?:|data:)[^"#]/);
});

test("canonical URLs, the sitemap and robots.txt name www.meetcal.app", async () => {
  const features = await readFile(new URL("../../dist/seo/features.html", import.meta.url), "utf8");
  assert.match(features, /<link id="canonical-url" rel="canonical" href="https:\/\/www\.meetcal\.app\/features"/);
  assert.match(features, /property="og:url" content="https:\/\/www\.meetcal\.app\/features"/);

  const sitemap = await readFile(new URL("../../public/sitemap.xml", import.meta.url), "utf8");
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url);
  assert.ok(locations.length > 0);
  for (const url of locations) assert.match(url, /^https:\/\/www\.meetcal\.app\//);

  const robots = await readFile(new URL("../../public/robots.txt", import.meta.url), "utf8");
  assert.match(robots, /^Sitemap: https:\/\/www\.meetcal\.app\/sitemap\.xml$/m);
});
