import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { bundleProblems, IOS_BUNDLE_BUDGET, iosBundlePathOfMetadata, sourcesOfSourceMap } from './bundle/budget';

const USAGE = 'Usage: bun scripts/check-bundle.ts [--from <expo export directory>]';

function exportIos(outputDir: string): void {
  const result = spawnSync(
    'bunx',
    ['expo', 'export', '--platform', 'ios', '--source-maps', '--output-dir', outputDir],
    { stdio: 'inherit' },
  );
  if (result.error) throw new Error(`Could not start expo export: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`expo export exited with ${result.status ?? result.signal}`);
}

function checkExport(outputDir: string): string[] {
  const bundlePath = join(outputDir, iosBundlePathOfMetadata(readFileSync(join(outputDir, 'metadata.json'), 'utf8')));
  const bytes = statSync(bundlePath).size;
  const sources = sourcesOfSourceMap(readFileSync(`${bundlePath}.map`, 'utf8'));
  console.log(
    `[bundle] iOS Hermes bundle: ${bytes} bytes (budget ${IOS_BUNDLE_BUDGET.maxBytes}), ${sources.length} source files`,
  );
  return bundleProblems({ bytes, sources }, IOS_BUNDLE_BUDGET);
}

function main(argv: string[]): void {
  const fromIndex = argv.indexOf('--from');
  const given = fromIndex === -1 ? undefined : argv[fromIndex + 1];
  if (argv.length !== (fromIndex === -1 ? 0 : 2) || (fromIndex !== -1 && given === undefined)) {
    console.error(USAGE);
    process.exit(2);
  }
  const outputDir = given ?? mkdtempSync(join(tmpdir(), 'meetcal-ios-export-'));
  try {
    if (given === undefined) exportIos(outputDir);
    const problems = checkExport(outputDir);
    for (const problem of problems) console.error(`[bundle] ${problem}`);
    if (problems.length > 0) process.exitCode = 1;
    else console.log('[bundle] Within budget, and no banned package is bundled');
  } finally {
    if (given === undefined) rmSync(outputDir, { recursive: true, force: true });
  }
}

main(process.argv.slice(2));
