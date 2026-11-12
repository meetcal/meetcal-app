import { NativeModules, Platform } from "react-native";

import { installedDataWidgets } from "./installedDataWidgets";

describe("installedDataWidgets", () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    Object.defineProperty(Platform, "OS", { configurable: true, get: () => "ios" });
  });

  afterEach(() => {
    delete NativeModules.SavedWidget;
    Object.defineProperty(Platform, "OS", { configurable: true, get: () => originalOS });
  });

  it.each([
    [["QualifyingTotalsWidget"], "some"],
    [["SavedWidget", "InternationalRankingsWidget"], "some"],
    [["SavedWidget"], "none"],
    [[], "none"],
    [{ kinds: [] }, "unknown"],
    [[7], "none"],
  ])("reads %j as %s", async (kinds, expected) => {
    NativeModules.SavedWidget = { installedWidgetKinds: jest.fn(async () => kinds) };
    await expect(installedDataWidgets()).resolves.toBe(expected);
  });

  it("is unknown when the binary has no method, the method fails, or the platform has no widgets", async () => {
    NativeModules.SavedWidget = {};
    await expect(installedDataWidgets()).resolves.toBe("unknown");
    NativeModules.SavedWidget = { installedWidgetKinds: jest.fn(async () => Promise.reject(new Error("WidgetCenter"))) };
    await expect(installedDataWidgets()).resolves.toBe("unknown");
    Object.defineProperty(Platform, "OS", { configurable: true, get: () => "web" });
    await expect(installedDataWidgets()).resolves.toBe("unknown");
  });
});
