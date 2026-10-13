import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../../styles.css", import.meta.url), "utf8");

test("every custom property styles.css reads is declared", () => {
  const declared = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(([, name]) => name));
  // A var() without a fallback that names an undeclared property makes its
  // whole declaration invalid, as `var(--shadow)` once did (#392).
  const undeclared = [...css.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)]
    .map(([, name]) => name)
    .filter((name) => !declared.has(name));
  assert.deepEqual([...new Set(undeclared)], []);
});
