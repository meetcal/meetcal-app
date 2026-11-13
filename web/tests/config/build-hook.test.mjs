import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const webDir = fileURLToPath(new URL("../../", import.meta.url));
const mise = await readFile(join(webDir, "mise.toml"), "utf8");

function taskCommand(name) {
  const match = mise.match(new RegExp(`^\\[tasks\\.${name}\\]\\nrun = "([^"]+)"$`, "m"));
  assert.ok(match, `mise.toml has no ${name} task`);
  return match[1];
}

async function runSiteHook(t, environment) {
  const scratch = await mkdtemp(join(tmpdir(), "meetcal-build-hook-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const staging = join(scratch, "staging");
  const bin = join(scratch, "bin");
  const trunkCalls = join(scratch, "trunk-calls");
  await mkdir(join(staging, "snippets", "meetcal-web-0123", "src"), { recursive: true });
  await mkdir(bin);
  await copyFile(join(webDir, "index.html"), join(staging, "index.html"));
  await writeFile(join(staging, "meetcal-web-0123456789abcdef.js"), 'import "./snippets/meetcal-web-0123/src/a.js";\n');
  await writeFile(join(staging, "meetcal-web-0123456789abcdef_bg.wasm"), "wasm");
  await writeFile(join(staging, "snippets", "meetcal-web-0123", "src", "a.js"), "export {};\n");
  await writeFile(join(bin, "trunk"), `#!/usr/bin/env bash\necho "$@" >> "${trunkCalls}"\nexit 1\n`);
  await chmod(join(bin, "trunk"), 0o755);

  const result = spawnSync("bash", [join(webDir, "scripts", "generate-bootstrap.sh")], {
    cwd: webDir,
    encoding: "utf8",
    env: {
      ...process.env,
      ...environment,
      PATH: `${bin}:${process.env.PATH}`,
      TRUNK_STAGING_DIR: staging,
      TRUNK_HTML_FILE: join(webDir, "index.html"),
    },
  });
  const calls = await readFile(trunkCalls, "utf8").catch(() => "");
  return { result, calls, staging };
}

test("the site's dev server skips the nested Schedule Builder build", async (t) => {
  assert.match(taskCommand("run"), /\bMEETCAL_WEB_SITE_ONLY=1 trunk serve\b/);
  const { result, calls, staging } = await runSiteHook(t, { MEETCAL_WEB_SITE_ONLY: "1" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(calls, "");
  assert.ok((await stat(join(staging, "seo", "features.html"))).isFile());
});

test("every other site build also builds the Schedule Builder", async (t) => {
  for (const name of ["build", "run-schedule-builder"]) {
    assert.doesNotMatch(taskCommand(name), /MEETCAL_WEB_SITE_ONLY/);
  }
  const vercelBuild = await readFile(join(webDir, "scripts", "vercel-build.sh"), "utf8");
  assert.doesNotMatch(vercelBuild, /MEETCAL_WEB_SITE_ONLY/);
  const { result, calls } = await runSiteHook(t, { MEETCAL_WEB_SITE_ONLY: "", TRUNK_PROFILE: "debug" });
  assert.notEqual(result.status, 0);
  assert.match(calls, /^build --locked --dist \S+ schedule-builder\.html$/m);
});
