export const IOS_HERMES_BUNDLE_BUDGET_BYTES = 9_200_000;

export const PACKAGES_BANNED_FROM_THE_IOS_BUNDLE = [
  '@revenuecat/purchases-js',
  '@revenuecat/purchases-js-hybrid-mappings',
  'react-dom',
  '@sentry/replay',
  '@sentry-internal/replay',
] as const;

export type ExportedBundle = {
  bytes: number;
  sources: readonly string[];
};

export type BundleBudget = {
  maxBytes: number;
  bannedPackages: readonly string[];
};

export const IOS_BUNDLE_BUDGET: BundleBudget = {
  maxBytes: IOS_HERMES_BUNDLE_BUDGET_BYTES,
  bannedPackages: PACKAGES_BANNED_FROM_THE_IOS_BUNDLE,
};

export function packageOfSource(source: string): string | null {
  const parts = source.split('/node_modules/');
  const inner = parts[parts.length - 1];
  if (parts.length < 2 || inner === undefined) return null;
  const [scopeOrName, name] = inner.split('/');
  if (scopeOrName === undefined || scopeOrName === '') return null;
  if (!scopeOrName.startsWith('@')) return scopeOrName;
  return name === undefined || name === '' ? null : `${scopeOrName}/${name}`;
}

export function bundleProblems(bundle: ExportedBundle, budget: BundleBudget): string[] {
  const problems: string[] = [];
  if (bundle.bytes > budget.maxBytes) {
    problems.push(`The iOS Hermes bundle is ${bundle.bytes} bytes, over its ${budget.maxBytes}-byte budget.`);
  }
  const banned = new Set(budget.bannedPackages);
  const found = new Map<string, number>();
  for (const source of bundle.sources) {
    const name = packageOfSource(source);
    if (name !== null && banned.has(name)) found.set(name, (found.get(name) ?? 0) + 1);
  }
  for (const [name, files] of found) {
    problems.push(`The iOS bundle includes ${name} (${files} ${files === 1 ? 'file' : 'files'}), which must stay out of it.`);
  }
  return problems;
}

export function sourcesOfSourceMap(text: string): string[] {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || !('sources' in parsed)) {
    throw new Error('The source map has no sources list.');
  }
  const { sources } = parsed;
  if (!Array.isArray(sources) || sources.length === 0) throw new Error('The source map lists no sources.');
  return sources.map((source, index) => {
    if (typeof source !== 'string') throw new Error(`The source map's source ${index} is not a path.`);
    return source;
  });
}

export function iosBundlePathOfMetadata(text: string): string {
  const parsed: unknown = JSON.parse(text);
  const bundle =
    typeof parsed === 'object' &&
    parsed !== null &&
    'fileMetadata' in parsed &&
    typeof parsed.fileMetadata === 'object' &&
    parsed.fileMetadata !== null &&
    'ios' in parsed.fileMetadata &&
    typeof parsed.fileMetadata.ios === 'object' &&
    parsed.fileMetadata.ios !== null &&
    'bundle' in parsed.fileMetadata.ios
      ? parsed.fileMetadata.ios.bundle
      : undefined;
  if (typeof bundle !== 'string' || !bundle.endsWith('.hbc')) {
    throw new Error('The export metadata names no iOS Hermes bundle.');
  }
  return bundle;
}
