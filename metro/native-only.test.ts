import path from "path";

const { nativeStubFor, withNativeOnlyResolver } = require("./native-only");

const purchases = path.join("/app", "node_modules", "react-native-purchases", "dist", "purchases.js");
const paywalls = path.join("/app", "node_modules", "react-native-purchases-ui", "src", "index.tsx");
const clerk = path.join("/app", "node_modules", "@clerk", "react", "dist", "index.cjs");

describe("native-only resolver", () => {
  it.each(["ios", "android"])("stubs the web-only modules on %s", (platform) => {
    expect(nativeStubFor(purchases, "./browser/nativeModule", platform)).toMatch(/purchases-browser\.js$/);
    expect(nativeStubFor(paywalls, "./preview/nativeModules", platform)).toMatch(/purchases-ui-preview\.js$/);
    expect(nativeStubFor(paywalls, "./preview/previewComponents", platform)).toMatch(/purchases-ui-preview\.js$/);
    expect(nativeStubFor(clerk, "react-dom", platform)).toMatch(/react-dom\.js$/);
    expect(nativeStubFor(clerk, "react-dom/client", platform)).toMatch(/react-dom\.js$/);
  });

  it("keeps the real modules on the web and for every other importer", () => {
    expect(nativeStubFor(purchases, "./browser/nativeModule", "web")).toBeNull();
    expect(nativeStubFor(clerk, "react-dom", "web")).toBeNull();
    expect(nativeStubFor(path.join("/app", "src", "app", "+html.tsx"), "react-dom", "ios")).toBeNull();
    expect(nativeStubFor(purchases, "./browser/utils", "ios")).toBeNull();
  });

  it("hands every other request to the resolver it wraps", () => {
    const upstream = jest.fn(() => ({ type: "sourceFile", filePath: "/real.js" }));
    const config = withNativeOnlyResolver({ resolver: { resolveRequest: upstream } });
    expect(config.resolver.resolveRequest({ originModulePath: clerk }, "react", "ios")).toEqual({
      type: "sourceFile",
      filePath: "/real.js",
    });
    expect(config.resolver.resolveRequest({ originModulePath: clerk }, "react-dom", "ios")).toEqual({
      type: "sourceFile",
      filePath: expect.stringMatching(/native-stubs[\\/]react-dom\.js$/),
    });
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("gives the stubs the names their importers read", () => {
    expect(Object.keys(require("./native-stubs/purchases-browser.js"))).toEqual(["browserNativeModuleRNPurchases"]);
    expect(Object.keys(require("./native-stubs/purchases-ui-preview.js")).sort()).toEqual([
      "PreviewCustomerCenter",
      "PreviewPaywall",
      "previewNativeModuleRNCustomerCenter",
      "previewNativeModuleRNPaywalls",
    ]);
    const reactDom = require("./native-stubs/react-dom.js");
    expect(reactDom.flushSync(() => 3)).toBe(3);
    expect(() => reactDom.createPortal()).toThrow("web-only");
  });
});
