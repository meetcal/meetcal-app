import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { brotliCompressSync, constants as zlib } from "node:zlib";
import test from "node:test";
import { pathToRegexp } from "path-to-regexp";

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
const CONTENT_HASH = /[-_.][0-9a-f]{15,16}(?:_bg)?(?:[./]|$)/;

function cacheControlFor(path) {
  for (const { source, headers } of config.headers) {
    const header = headers.find(({ key }) => key.toLowerCase() === "cache-control");
    if (header && pathToRegexp(source).test(path)) return header.value;
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

test("the glue and the snippet folder are named by their own content, so a year's cache never serves a stale one", async () => {
  const dist = new URL("../../dist/", import.meta.url);
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const [snippetFolder, ...others] = await readdir(new URL("snippets/", dist));
  assert.equal(others.length, 0);
  const snippetFiles = (await filesUnder("../../dist/snippets/" + snippetFolder + "/"))
    .map((path) => "." + path)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const snippetBytes = Buffer.concat(
    await Promise.all(snippetFiles.map((path) => readFile(new URL(`snippets/${snippetFolder}/${path.slice(2)}`, dist)))),
  );
  assert.ok(snippetFolder.endsWith(`-${hash(snippetBytes)}`), `${snippetFolder} is not named by its content`);
  const glue = (await readdir(dist)).filter((file) => /^meetcal-web-[0-9a-f]{16}\.js$/.test(file));
  assert.equal(glue.length, 1);
  const glueText = await readFile(new URL(glue[0], dist));
  assert.equal(glue[0], `meetcal-web-${hash(glueText)}.js`);
  const imported = [...glueText.toString().matchAll(/from ["']\.\/(snippets\/[^"']+)["']/g)].map(([, path]) => path);
  assert.ok(imported.length > 0, "the glue imports no snippet");
  for (const path of imported) {
    assert.ok(path.startsWith(`snippets/${snippetFolder}/`), `the glue imports ${path} from another folder`);
    await readFile(new URL(path, dist));
  }
  const importObjectKeys = [...glueText.toString().matchAll(/"\.\/(snippets\/[^"]+)": import/g)].map(([, path]) => path);
  for (const path of importObjectKeys) {
    assert.ok(!path.startsWith(`snippets/${snippetFolder}/`), `${path}: the Wasm imports its snippets under the name wasm-bindgen gave them`);
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
      assert.match(head, new RegExp(`<link rel="modulepreload" href="/snippets/meetcal-web-[0-9a-f]+-[0-9a-f]{16}/src/${snippet.replace(".", "\\.")}"`), `${file}: no ${snippet} modulepreload`);
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

const budgets = JSON.parse(await readFile(new URL("../budgets.json", import.meta.url), "utf8"));
const WASM_RAW_BUDGET_BYTES = budgets.wasmRawBytes;
const WASM_BROTLI_11_BUDGET_BYTES = budgets.wasmBrotli11Bytes;
const REQUESTS_BEFORE_WASM_BUDGET = budgets.requestsBeforeWasm;

async function builtWasm() {
  const dist = new URL("../../dist/", import.meta.url);
  const names = (await readdir(dist)).filter((file) => /^meetcal-web-[0-9a-f]{16}_bg\.wasm$/.test(file));
  assert.equal(names.length, 1, "expected one content-hashed Wasm binary in dist/");
  return readFile(new URL(names[0], dist));
}

async function builtPages() {
  const seo = (await readdir(new URL("../../dist/seo/", import.meta.url))).map((file) => `seo/${file}`);
  return ["index.html", "404.html", ...seo.filter((file) => file.endsWith(".html"))];
}

test("the Wasm binary stays inside its raw and brotli-11 size budgets", async () => {
  const wasm = await builtWasm();
  assert.ok(
    wasm.length <= WASM_RAW_BUDGET_BYTES,
    `the Wasm binary is ${wasm.length} bytes, over its ${WASM_RAW_BUDGET_BYTES}-byte budget`,
  );
  const brotli = brotliCompressSync(wasm, {
    params: {
      [zlib.BROTLI_PARAM_QUALITY]: 11,
      [zlib.BROTLI_PARAM_SIZE_HINT]: wasm.length,
    },
  });
  assert.ok(
    brotli.length <= WASM_BROTLI_11_BUDGET_BYTES,
    `the Wasm binary is ${brotli.length} bytes at brotli 11, over its ${WASM_BROTLI_11_BUDGET_BYTES}-byte budget`,
  );
});

test("no page asks for more than its budget of files before the Wasm binary", async () => {
  const fetching = /<link\b[^>]*\brel="(?:stylesheet|preload|modulepreload)"[^>]*>|<script\b[^>]*\bsrc=/g;
  for (const file of await builtPages()) {
    const html = await readFile(new URL(`../../dist/${file}`, import.meta.url), "utf8");
    const wasmPreload = html.search(/<link rel="preload" href="\/meetcal-web-[0-9a-f]+_bg\.wasm"/);
    assert.ok(wasmPreload > 0, `${file}: no wasm preload`);
    const before = html.slice(0, wasmPreload).match(fetching) ?? [];
    const requests = 1 + before.length;
    assert.ok(
      requests <= REQUESTS_BEFORE_WASM_BUDGET,
      `${file}: ${requests} requests (the page and ${before.join(", ")}) start before the Wasm binary; the budget is ${REQUESTS_BEFORE_WASM_BUDGET}`,
    );
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
