import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const config = JSON.parse(
  await readFile(new URL("../../vercel.json", import.meta.url), "utf8"),
);

function headersFor(source) {
  const rule = config.headers.find((rule) => rule.source === source);
  return rule
    ? Object.fromEntries(rule.headers.map(({ key, value }) => [key.toLowerCase(), value]))
    : {};
}

test("Trunk's content-hashed assets are cached for a year", () => {
  for (const source of ["/meetcal-web-(.*)", "/styles-(.*).css"]) {
    assert.equal(
      headersFor(source)["cache-control"],
      "public, max-age=31536000, immutable",
      `${source} should be immutable`,
    );
  }
  // The bootstrap and the HTML keep their names across deploys, so they must
  // revalidate: no rule may make them immutable.
  for (const { source, headers } of config.headers) {
    const cacheControl = headers.find(({ key }) => key.toLowerCase() === "cache-control");
    if (!cacheControl) continue;
    assert.match(source, /^\/(meetcal-web-|styles-)/, `${source} must not be cached immutably`);
  }
});

test("the release build optimizes the Wasm binary for size", async () => {
  const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
  assert.match(html, /<link data-trunk rel="rust" data-wasm-opt="z"[^>]*\/>/);

  const cargo = await readFile(new URL("../../Cargo.toml", import.meta.url), "utf8");
  const release = cargo.slice(cargo.indexOf("[profile.release]"));
  for (const setting of ['opt-level = "z"', "lto = true", "codegen-units = 1", "strip = true"]) {
    assert.ok(release.includes(setting), `[profile.release] is missing ${setting}`);
  }
});

test("every page shows a loading shell until the app mounts", async () => {
  for (const file of ["index.html", "seo/features.html", "seo/results.html"]) {
    const html = await readFile(new URL(`../../dist/${file}`, import.meta.url), "utf8");
    assert.match(html, /<div id="app-loading"[^>]*role="status"/, `${file} has no loading shell`);
    assert.match(html, /<noscript>/, `${file} has no <noscript> message`);
    // A reload that needs no script, for a bootstrap that never loads.
    assert.match(html, /<p class="app-loading-slow">[^<]*<a href="">/, `${file} has no slow-load reload link`);
  }
});

test("the bootstrap reports a failed load instead of leaving the page blank", async () => {
  const bootstrap = await readFile(new URL("../../dist/app-bootstrap.js", import.meta.url), "utf8");
  // A static import would fail before any handler runs; the import must be dynamic.
  assert.doesNotMatch(bootstrap, /^import /m);
  assert.match(bootstrap, /await import\("\/meetcal-web-[0-9a-f]+\.js"\)/);
  assert.match(bootstrap, /module_or_path: "\/meetcal-web-[0-9a-f]+_bg\.wasm"/);
  assert.match(bootstrap, /catch \(error\)/);
  assert.match(bootstrap, /couldn\\u2019t load/);
  assert.match(bootstrap, /location\.reload\(\)/);
});
