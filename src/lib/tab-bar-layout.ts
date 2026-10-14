/**
 * Which tab bar the app draws and how tall the JS one is.
 *
 * iOS 26+ uses expo-router's `NativeTabs` (UIKit's tab bar). Everything else
 * (Android, iOS 18-25, and Maestro runs) uses the JS `Tabs` bar, which is
 * absolutely positioned over the bottom of each screen. Its height used to be
 * a fixed 70 with `paddingBottom: 15`, which replaced react-navigation's own
 * safe-area sizing: Android's 3-button navigation bar (edge-to-edge, 48dp)
 * covered the lower half of the icons, and the Schedule day dots, placed
 * from the raw bottom inset, sat behind the bar on iOS 18-25.
 */

/** Height of the JS tab bar's icon row, above the system inset. */
export const JS_TAB_BAR_CONTENT_HEIGHT = 55;
/**
 * Bottom padding when the system reports little or no inset (a Home-button
 * iPhone, Android gesture navigation): the bar's original 70 / 15 layout.
 */
export const JS_TAB_BAR_MIN_BOTTOM_PADDING = 15;

export function usesNativeTabs(
  platformOS: string,
  platformVersion: string | number,
  isMaestroE2E: boolean,
): boolean {
  if (platformOS !== "ios" || isMaestroE2E) return false;
  const major = parseInt(String(platformVersion).split(".")[0], 10);
  return Number.isFinite(major) && major >= 26;
}

export interface JsTabBarLayout {
  height: number;
  paddingBottom: number;
}

/** The JS tab bar's size for a given bottom safe-area inset. */
export function jsTabBarLayout(insetBottom: number): JsTabBarLayout {
  const paddingBottom = Math.max(insetBottom, JS_TAB_BAR_MIN_BOTTOM_PADDING);
  return { height: JS_TAB_BAR_CONTENT_HEIGHT + paddingBottom, paddingBottom };
}

/** Gap between the Schedule day dots and whatever is below them. */
export const PAGE_INDICATOR_GAP = 5;

/**
 * Distance of the Schedule day dots from the bottom of the screen.
 *
 * Under `NativeTabs`, UIKit adds the tab bar to the safe-area inset, so the
 * inset already clears it. The JS bar leaves the inset alone (it is only the
 * home indicator or the Android navigation bar), so the dots go above the
 * bar's full height.
 */
export function pageIndicatorBottom(insetBottom: number, nativeTabs: boolean): number {
  if (nativeTabs) return insetBottom + PAGE_INDICATOR_GAP;
  return jsTabBarLayout(insetBottom).height + PAGE_INDICATOR_GAP;
}
