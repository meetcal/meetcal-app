/**
 * The one way the app turns a mounted view into a shareable PNG.
 *
 * Three screens grew their own copy of this (club meet recap, Weightlifting
 * Wrapped, the start-list schedule image) and they disagreed on every axis:
 * static vs dynamic import of `react-native-view-shot`, React Native's
 * `Share` vs `expo-sharing`, and how failures were surfaced. The mechanics
 * live here; screens keep their own user-facing messaging.
 *
 * `react-native-view-shot` is loaded lazily on purpose: evaluating it binds
 * its native module, and nothing needs that until the user actually taps a
 * share button. The `import type` below is erased at compile time and loads
 * nothing.
 */
import * as Sharing from "expo-sharing";
import type * as ViewShot from "react-native-view-shot";

/** Anything `captureRef` accepts: a ref, a host node, or a node handle. */
export type CaptureTarget = Parameters<typeof ViewShot.captureRef>[0];

/**
 * Capture `view` to a full-quality PNG in the temp directory and return its
 * `file://` uri.
 *
 * @param width Render width in points. Omit to capture at the view's own
 *   on-screen size; set it when the image must be a fixed size regardless of
 *   the device (the start-list schedule image is always 850pt wide).
 */
export function captureViewAsPng(
  view: CaptureTarget,
  options?: { width?: number },
): Promise<string> {
  // An inline `require` rather than `await import()`: Metro keeps both lazy,
  // but Jest's CommonJS environment cannot execute a dynamic import, and this
  // is the module worth having a test for.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { captureRef } = require("react-native-view-shot") as typeof ViewShot;
  // Include `width` only when set. view-shot validates with `"width" in
  // options`, so an explicit `undefined` key (or `height: undefined`) logs a
  // "bad options" warning on every capture, in release builds too.
  return captureRef(view, {
    format: "png",
    quality: 1,
    result: "tmpfile",
    ...(options?.width !== undefined && { width: options.width }),
  });
}

/**
 * Hand a captured PNG to the platform share sheet.
 *
 * Throws when the device has no share sheet at all, so callers can fall back
 * (Wrapped shares plain text instead) or toast.
 */
export async function shareImageFile(
  uri: string,
  dialogTitle: string,
): Promise<void> {
  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) {
    throw new Error("Sharing is not available on this device");
  }

  await Sharing.shareAsync(uri, {
    mimeType: "image/png",
    dialogTitle,
  });
}
