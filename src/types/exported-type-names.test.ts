import { readdirSync, readFileSync } from "fs";
import { join, relative } from "path";

const SRC = join(__dirname, "..");
const EXPORTED_TYPE = /^export (?:declare )?(?:type|interface) (\w+)/gm;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    const isSource = /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts");
    const isTest = /\.test\.tsx?$/.test(entry.name);
    return isSource && !isTest ? [path] : [];
  });
}

function filesByExportedTypeName(): Map<string, string[]> {
  const files = new Map<string, string[]>();
  for (const path of sourceFiles(SRC)) {
    for (const match of readFileSync(path, "utf8").matchAll(EXPORTED_TYPE)) {
      const name = match[1];
      if (name === undefined) continue;
      files.set(name, [...(files.get(name) ?? []), relative(SRC, path)]);
    }
  }
  return files;
}

describe("exported type names", () => {
  it("each name is exported by one file in src/, so a shape has one definition", () => {
    const repeated = [...filesByExportedTypeName()]
      .filter(([, files]) => files.length > 1)
      .map(([name, files]) => `${name}: ${files.join(", ")}`);
    expect(repeated).toEqual([]);
  });

  it("finds the exported types it checks", () => {
    expect(filesByExportedTypeName().get("Meet")).toEqual(["data/types/meet.ts"]);
  });
});
