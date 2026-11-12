const path = require("path");

const STUBS = path.join(__dirname, "native-stubs");

const NATIVE_STUBS = [
  {
    from: /react-native-purchases[\\/]dist[\\/]purchases\.js$/,
    request: "./browser/nativeModule",
    stub: "purchases-browser.js",
  },
  {
    from: /react-native-purchases-ui[\\/]src[\\/]index\.tsx$/,
    request: "./preview/nativeModules",
    stub: "purchases-ui-preview.js",
  },
  {
    from: /react-native-purchases-ui[\\/]src[\\/]index\.tsx$/,
    request: "./preview/previewComponents",
    stub: "purchases-ui-preview.js",
  },
  { from: /@clerk[\\/]react[\\/]/, request: "react-dom", stub: "react-dom.js" },
  { from: /@clerk[\\/]react[\\/]/, request: "react-dom/client", stub: "react-dom.js" },
];

function nativeStubFor(originModulePath, moduleName, platform) {
  if (platform !== "ios" && platform !== "android") return null;
  const match = NATIVE_STUBS.find((entry) => entry.request === moduleName && entry.from.test(originModulePath));
  return match ? path.join(STUBS, match.stub) : null;
}

function withNativeOnlyResolver(config) {
  const upstream = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const stub = nativeStubFor(context.originModulePath, moduleName, platform);
    if (stub) return { type: "sourceFile", filePath: stub };
    return upstream ? upstream(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
  };
  return config;
}

module.exports = { nativeStubFor, withNativeOnlyResolver, NATIVE_STUBS };
