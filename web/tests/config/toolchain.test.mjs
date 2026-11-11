import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const mise = await read("../../mise.toml");
const vercelBuild = await read("../../scripts/vercel-build.sh");
const workflow = await read("../../../.github/workflows/web.yml");
const cargoLock = await read("../../Cargo.lock");

function only(text, pattern, what) {
  const versions = [...text.matchAll(pattern)].map((match) => match[1]);
  assert.equal(versions.length, 1, `expected one ${what}, found ${versions.length}`);
  return versions[0];
}

const miseTools = Object.fromEntries(
  [...mise.matchAll(/^"?([\w:.-]+)"? = (?:"([^"]+)"|\{ version = "([^"]+)")/gm)].map((match) => [
    match[1],
    match[2] ?? match[3],
  ]),
);

test("CI builds with the Trunk the deploy installs", () => {
  const deployed = only(vercelBuild, /cargo install trunk --version (\S+)/g, "Trunk install in vercel-build.sh");
  const ci = only(workflow, /cargo install trunk --version (\S+)/g, "Trunk install in web.yml");
  assert.equal(ci, deployed);
});

test("local builds use the Rust that CI and the deploy install", () => {
  const deployed = only(vercelBuild, /^rust_toolchain="([^"]+)"/gm, "Rust toolchain in vercel-build.sh");
  const ci = new Set([...workflow.matchAll(/toolchain: "([^"]+)"/g)].map((match) => match[1]));
  assert.deepEqual([...ci], [deployed]);
  assert.equal(miseTools.rust, deployed);
});

test("every build tool is pinned to an exact version", () => {
  const exact = /^\d+\.\d+\.\d+$/;
  for (const tool of ["rust", "mr-boxington", "cargo:cargo-audit", "cargo:trunk", "cargo:leptosfmt", "cargo:wasm-bindgen-cli", "npm:prettier"]) {
    assert.match(miseTools[tool] ?? "missing", exact, `${tool} is not pinned in mise.toml`);
  }
});

test("the wasm-bindgen CLI is the wasm-bindgen crate's version", () => {
  const crate = only(cargoLock, /name = "wasm-bindgen"\nversion = "([^"]+)"/g, "wasm-bindgen crate in Cargo.lock");
  assert.equal(miseTools["cargo:wasm-bindgen-cli"], crate);
});

test("every release build takes Cargo.lock as it is", () => {
  for (const [name, text] of [["mise.toml", mise], ["vercel-build.sh", vercelBuild], ["web.yml", workflow]]) {
    const builds = [...text.matchAll(/trunk build[^\n"]*/g)].map((match) => match[0]);
    assert.ok(builds.length > 0, `${name} has no trunk build`);
    for (const build of builds) assert.match(build, /--locked/, `${name}: ${build}`);
  }
});
