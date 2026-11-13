import {
  bundleProblems,
  IOS_BUNDLE_BUDGET,
  iosBundlePathOfMetadata,
  packageOfSource,
  sourcesOfSourceMap,
} from './budget';

const appSources = ['/node_modules/react-native/index.js', '/src/app/_layout.tsx', '/node_modules/@sentry/browser/build/index.js'];

describe('packageOfSource', () => {
  it('names the package a bundled file came from, scoped or not', () => {
    expect(packageOfSource('/node_modules/react-dom/cjs/react-dom.production.js')).toBe('react-dom');
    expect(packageOfSource('/node_modules/@revenuecat/purchases-js/dist/Purchases.es.js')).toBe('@revenuecat/purchases-js');
    expect(packageOfSource('/node_modules/@revenuecat/purchases-js-hybrid-mappings/dist/index.js')).toBe(
      '@revenuecat/purchases-js-hybrid-mappings',
    );
    expect(packageOfSource('/node_modules/a/node_modules/@sentry/replay/build/index.js')).toBe('@sentry/replay');
  });

  it('names no package for the app’s own files or a malformed path', () => {
    expect(packageOfSource('/src/app/_layout.tsx')).toBeNull();
    expect(packageOfSource('/node_modules/')).toBeNull();
    expect(packageOfSource('/node_modules/@scope')).toBeNull();
  });
});

describe('bundleProblems', () => {
  it('passes a bundle within budget with no banned package', () => {
    expect(bundleProblems({ bytes: IOS_BUNDLE_BUDGET.maxBytes, sources: appSources }, IOS_BUNDLE_BUDGET)).toEqual([]);
  });

  it('fails a bundle one byte over budget', () => {
    expect(bundleProblems({ bytes: IOS_BUNDLE_BUDGET.maxBytes + 1, sources: appSources }, IOS_BUNDLE_BUDGET)).toEqual([
      `The iOS Hermes bundle is ${IOS_BUNDLE_BUDGET.maxBytes + 1} bytes, over its ${IOS_BUNDLE_BUDGET.maxBytes}-byte budget.`,
    ]);
  });

  it('fails each banned package once, counting its files, and not a package whose name only starts the same', () => {
    const sources = [
      ...appSources,
      '/node_modules/react-dom/index.js',
      '/node_modules/react-dom/client.js',
      '/node_modules/@sentry-internal/replay/build/index.js',
      '/node_modules/react-dom-extras/index.js',
    ];
    expect(bundleProblems({ bytes: 1, sources }, IOS_BUNDLE_BUDGET)).toEqual([
      'The iOS bundle includes react-dom (2 files), which must stay out of it.',
      'The iOS bundle includes @sentry-internal/replay (1 file), which must stay out of it.',
    ]);
  });
});

describe('sourcesOfSourceMap', () => {
  it('reads the source list', () => {
    expect(sourcesOfSourceMap(JSON.stringify({ version: 3, sources: appSources }))).toEqual(appSources);
  });

  it('refuses a map without sources, so a broken export cannot pass as clean', () => {
    expect(() => sourcesOfSourceMap('{"version":3}')).toThrow('no sources list');
    expect(() => sourcesOfSourceMap('{"sources":[]}')).toThrow('lists no sources');
    expect(() => sourcesOfSourceMap('{"sources":[1]}')).toThrow('source 0 is not a path');
  });
});

describe('iosBundlePathOfMetadata', () => {
  it('reads the Hermes bundle the export wrote', () => {
    const metadata = { fileMetadata: { ios: { bundle: '_expo/static/js/ios/entry-abc.hbc', assets: [] } } };
    expect(iosBundlePathOfMetadata(JSON.stringify(metadata))).toBe('_expo/static/js/ios/entry-abc.hbc');
  });

  it('refuses metadata with no Hermes bundle', () => {
    expect(() => iosBundlePathOfMetadata('{"fileMetadata":{}}')).toThrow('names no iOS Hermes bundle');
    expect(() => iosBundlePathOfMetadata('{"fileMetadata":{"ios":{"bundle":"entry.js"}}}')).toThrow(
      'names no iOS Hermes bundle',
    );
  });
});
