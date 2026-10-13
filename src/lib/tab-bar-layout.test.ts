import {
  jsTabBarLayout,
  pageIndicatorBottom,
  usesNativeTabs,
} from "@/lib/tab-bar-layout";

describe("usesNativeTabs", () => {
  it("is iOS 26 and later only, and never under Maestro", () => {
    expect(usesNativeTabs("ios", "26.0", false)).toBe(true);
    expect(usesNativeTabs("ios", "27.1", false)).toBe(true);
    expect(usesNativeTabs("ios", "18.4", false)).toBe(false);
    expect(usesNativeTabs("ios", "25.9", false)).toBe(false);
    expect(usesNativeTabs("ios", "27.1", true)).toBe(false);
    expect(usesNativeTabs("android", 36, false)).toBe(false);
  });
});

describe("jsTabBarLayout", () => {
  it("keeps the original 70 / 15 bar when there is no meaningful inset", () => {
    expect(jsTabBarLayout(0)).toEqual({ height: 70, paddingBottom: 15 });
  });

  it("grows by the inset so Android's 3-button navigation bar doesn't cover the icons", () => {
    const bar = jsTabBarLayout(48);
    expect(bar.paddingBottom).toBe(48);
    // The icon row above the system bar keeps its full height.
    expect(bar.height - bar.paddingBottom).toBe(55);
  });

  it("clears the iOS home indicator", () => {
    expect(jsTabBarLayout(34)).toEqual({ height: 89, paddingBottom: 34 });
  });
});

describe("pageIndicatorBottom", () => {
  it("sits just above the inset under native tabs, which already includes the bar", () => {
    expect(pageIndicatorBottom(83, true)).toBe(88);
  });

  it("sits above the JS tab bar, not behind it (iOS 18-25, Android)", () => {
    expect(pageIndicatorBottom(34, false)).toBe(89 + 5);
    expect(pageIndicatorBottom(0, false)).toBe(70 + 5);
    expect(pageIndicatorBottom(48, false)).toBe(103 + 5);
  });
});
