#!/usr/bin/env bun
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const LCOV_PATH = process.env.LCOV_PATH ?? join(ROOT, "coverage", "lcov.info");

const SOURCE_ROOTS = [
  "app",
  "components",
  "hooks",
  "lib",
  "utils",
  "contexts",
] as const;

const IGNORE_DIR_NAMES = new Set([
  "node_modules",
  "scrapers",
  "coverage",
  "ios",
  "android",
  "widget",
  "targets",
  ".git",
]);

type FileCoverage = {
  path: string;
  linesFound: number;
  linesHit: number;
};

function walkSourceFiles(dir: string, acc: string[]): void {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORE_DIR_NAMES.has(entry)) continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      walkSourceFiles(full, acc);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry)) continue;
    if (entry.endsWith(".d.ts")) continue;
    acc.push(full);
  }
}

function parseLcov(lcov: string): Map<string, FileCoverage> {
  const files = new Map<string, FileCoverage>();
  let current: FileCoverage | null = null;

  for (const line of lcov.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      const raw = line.slice(3).trim();
      const path = raw.startsWith(ROOT)
        ? relative(ROOT, raw)
        : raw.replace(/^\.\//, "");
      current = { path, linesFound: 0, linesHit: 0 };
    } else if (line.startsWith("DA:") && current) {
      current.linesFound += 1;
      const hit = Number(line.split(",")[1] ?? "0");
      if (hit > 0) current.linesHit += 1;
    } else if (line.startsWith("end_of_record") && current) {
      files.set(current.path, current);
      current = null;
    }
  }
  return files;
}

function percent(hit: number, found: number): number {
  if (found <= 0) return 0;
  return (100 * hit) / found;
}

function relatedTestHint(file: string): string {
  const withoutExt = file.replace(/\.(tsx|ts)$/, "");
  const candidates = [
    `${withoutExt}.test.ts`,
    `${withoutExt}.test.tsx`,
    `${withoutExt}.spec.ts`,
    `${withoutExt}.spec.tsx`,
  ];
  const found = candidates.filter((candidate) => existsSync(join(ROOT, candidate)));
  return found.length > 0 ? found.join(", ") : "(none next to source)";
}

function main(): void {
  if (!existsSync(LCOV_PATH)) {
    console.error(
      `No lcov at ${LCOV_PATH}. Run: bun run test:coverage`,
    );
    process.exit(1);
  }

  const coverage = parseLcov(readFileSync(LCOV_PATH, "utf8"));
  const sources: string[] = [];
  for (const root of SOURCE_ROOTS) {
    walkSourceFiles(join(ROOT, root), sources);
  }

  const rows = sources
    .map((full) => relative(ROOT, full))
    .map((path) => {
      const entry = coverage.get(path);
      const found = entry?.linesFound ?? 0;
      const hit = entry?.linesHit ?? 0;
      return {
        path,
        found,
        hit,
        pct: percent(hit, found),
        missingFromLcov: !entry,
        testHint: relatedTestHint(path),
      };
    })
    .sort((a, b) => a.pct - b.pct || a.path.localeCompare(b.path));

  const uncovered = rows.filter((row) => row.missingFromLcov || row.pct === 0);
  const low = rows.filter((row) => !row.missingFromLcov && row.pct > 0 && row.pct < 50);

  console.log(`lcov: ${LCOV_PATH}`);
  console.log(`source files: ${rows.length}`);
  console.log(`zero coverage or missing from lcov: ${uncovered.length}`);
  console.log(`hit but <50%: ${low.length}`);
  console.log("");
  console.log("Risk-first gaps (not a vanity % target):");
  console.log("");

  const print = (
    title: string,
    items: typeof rows,
    limit: number,
  ) => {
    console.log(`## ${title}`);
    if (items.length === 0) {
      console.log("(none)");
      console.log("");
      return;
    }
    for (const row of items.slice(0, limit)) {
      const pctLabel = row.missingFromLcov
        ? "missing"
        : `${row.pct.toFixed(1)}% (${row.hit}/${row.found})`;
      console.log(`- ${row.path}  ${pctLabel}  tests: ${row.testHint}`);
    }
    if (items.length > limit) {
      console.log(`- … ${items.length - limit} more`);
    }
    console.log("");
  };

  print("Zero / missing", uncovered, 40);
  print("Below 50%", low, 20);
}

main();
