import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
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

const IMMUTABLE = "public, max-age=31536000, immutable";
const CONTENT_HASH = /[-_.][0-9a-f]{16}(?:_bg)?(?:[./]|$)/;

function sourcePattern(source) {
  const literal = (text) => text.replace(/[.+?^${}[\]\\]/g, "\\$&");
  return new RegExp(`^${source.split("(.*)").map(literal).join("(.*)")}$`);
}

function cacheControlFor(path) {
  for (const { source, headers } of config.headers) {
    const header = headers.find(({ key }) => key.toLowerCase() === "cache-control");
    if (header && sourcePattern(source).test(path)) return header.value;
  }
  return undefined;
}

async function filesUnder(directory, prefix = "") {
  const entries = await readdir(new URL(directory, import.meta.url), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await filesUnder(`${directory}${entry.name}/`, path)));
    else files.push(path);
  }
  return files;
}

test("every content-hashed file in the build is cached for a year, and nothing else is", async () => {
  const files = await filesUnder("../../dist/");
  const hashed = files.filter((path) => CONTENT_HASH.test(path));
  for (const required of [/^\/meetcal-web-.*\.js$/, /_bg\.wasm$/, /^\/styles-.*\.css$/, /^\/snippets\/.*auth_bridge\.js$/, /^\/app-bootstrap-.*\.js$/]) {
    assert.ok(hashed.some((path) => required.test(path)), `no hashed file matches ${required}`);
  }
  for (const path of files) {
    if (hashed.includes(path)) {
      assert.equal(cacheControlFor(path), IMMUTABLE, `${path} is content-hashed and must be immutable`);
    } else {
      assert.notEqual(cacheControlFor(path), IMMUTABLE, `${path} keeps its name across deploys and must not be immutable`);
    }
  }
});

test("pages and the routes they rewrite to revalidate on every visit", () => {
  for (const path of ["/", "/index.html", "/404.html", "/seo/records.html", "/records"]) {
    assert.equal(cacheControlFor(path), undefined, `${path} must keep Vercel's revalidating default`);
  }
});

test("every page starts the app's downloads with the HTML", async () => {
  for (const file of ["index.html", "seo/records.html", "seo/wrapped.html", "404.html"]) {
    const html = await readFile(new URL(`../../dist/${file}`, import.meta.url), "utf8");
    const head = html.slice(0, html.indexOf("</head>"));
    assert.match(head, /<link rel="modulepreload" href="\/meetcal-web-[0-9a-f]+\.js"/, `${file}: no glue modulepreload`);
    for (const snippet of ["auth_bridge.js", "answer_store.js"]) {
      assert.match(head, new RegExp(`<link rel="modulepreload" href="/snippets/meetcal-web-[0-9a-f]+/src/${snippet.replace(".", "\\.")}"`), `${file}: no ${snippet} modulepreload`);
    }
    assert.match(head, /<link rel="preload" href="\/meetcal-web-[0-9a-f]+_bg\.wasm" as="fetch" type="application\/wasm" crossorigin/, `${file}: no wasm preload`);
    assert.doesNotMatch(head, /<script src=/, `${file}: a classic script in <head> blocks the first paint`);
  }
});

test("every page shell paints its route's own page before the app runs", async () => {
  const routes = (await readFile(new URL("../../shells/routes.txt", import.meta.url), "utf8")).trim().split("\n");
  assert.ok(routes.length >= 20);
  for (const line of routes) {
    const [stem] = line.split("|");
    const file = stem === "index" ? "index.html" : stem === "404" ? "404.html" : `seo/${stem}.html`;
    const html = await readFile(new URL(`../../dist/${file}`, import.meta.url), "utf8");
    const shell = await readFile(new URL(`../../shells/${stem}.html`, import.meta.url), "utf8");
    assert.ok(html.includes(`<div id="app-prerendered" class="app-prerendered">${shell.trimEnd()}</div>`), `${file} lacks its route's shell`);
    assert.match(shell, /<h1[ >]/, `${stem} has no heading`);
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
  for (const file of ["index.html", "seo/features.html", "seo/results.html", "404.html"]) {
    const html = await readFile(new URL(`../../dist/${file}`, import.meta.url), "utf8");
    assert.match(html, /<div id="app-loading"[^>]*role="status"/, `${file} has no loading shell`);
    assert.match(html, /<noscript>/, `${file} has no <noscript> message`);
    // A reload that needs no script, for a bootstrap that never loads.
    assert.match(html, /<p class="app-loading-slow">[^<]*<a href="">/, `${file} has no slow-load reload link`);
  }
});

test("the bootstrap reports a failed load instead of leaving the page blank", async () => {
  const name = (await readdir(new URL("../../dist/", import.meta.url))).find((file) => /^app-bootstrap-[0-9a-f]{16}\.js$/.test(file));
  assert.ok(name, "no content-hashed bootstrap in dist/");
  const bootstrap = await readFile(new URL(`../../dist/${name}`, import.meta.url), "utf8");
  assert.doesNotMatch(bootstrap, /^import /m);
  assert.match(bootstrap, /await import\("\/meetcal-web-[0-9a-f]+\.js"\)/);
  assert.match(bootstrap, /module_or_path: "\/meetcal-web-[0-9a-f]+_bg\.wasm"/);
  assert.match(bootstrap, /catch \(error\)/);
  assert.match(bootstrap, /couldn\\u2019t load/);
  assert.match(bootstrap, /location\.reload\(\)/);
  assert.match(bootstrap, /startAnalytics\(\);\n\} catch/, "analytics must start only once the app has mounted");
  const html = await readFile(new URL("../../dist/index.html", import.meta.url), "utf8");
  assert.ok(html.includes(`<script type="module" src="/${name}"></script>`));
});
