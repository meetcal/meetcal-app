import { readFileSync } from "node:fs";

const COMPARED_PARTS = ["args", "returns", "visibility", "functionType"] as const;

type Spec = Record<string, unknown>;

const isRecord = (value: unknown): value is Spec =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nameOf = (spec: Spec): string =>
  typeof spec.identifier === "string"
    ? spec.identifier
    : `${String(spec.method)} ${String(spec.path)}`;

const functionsOf = (path: string): Map<string, Spec> => {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed) || !Array.isArray(parsed.functions)) {
    throw new Error(`${path} is not a convex function-spec output`);
  }
  return new Map(parsed.functions.filter(isRecord).map((spec) => [nameOf(spec), spec]));
};

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error("Usage: bun function-spec-diff.ts <before.json> <after.json>");
  process.exit(2);
}
const before = functionsOf(beforePath);
const after = functionsOf(afterPath);
const removed = [...before.keys()].filter((name) => !after.has(name)).sort();
const added = [...after.keys()].filter((name) => !before.has(name)).sort();
const changed = [...after.keys()]
  .filter((name) => before.has(name))
  .sort()
  .flatMap((name) => {
    const parts = COMPARED_PARTS.filter(
      (part) => !same(before.get(name)?.[part], after.get(name)?.[part]),
    );
    return parts.length > 0 ? [`${name}: ${parts.join(", ")}`] : [];
  });
const list = (lines: string[]) => lines.map((line) => `\n  ${line}`).join("");
console.log(`Removed by this deploy (${removed.length}):${list(removed)}`);
console.log(`Added (${added.length}):${list(added)}`);
console.log(`Changed (${changed.length}):${list(changed)}`);
