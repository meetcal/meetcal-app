# iPhone Duo

MeetCal is built against the **iOS 27.1 SDK** so it gets full compatibility mode on the
iPhone Duo inner display. Apps built against an older SDK are letterboxed:

| Built against | Behaviour on the inner display |
|---|---|
| < iOS 27.0 SDK | Single narrow safe area on a black background |
| iOS 27.0 SDK | Most of the wide display, empty space at the edges |
| iOS 27.1 SDK | Full screen |

Apple stops accepting uploads built with an SDK older than iOS 27 in April 2027.

## Build requirements

- **Xcode 27.1** (ships the iOS 27.1 SDK and the iPhone Duo simulator).
  On this machine it lives at `/Applications/Xcode copy.app`; Xcode 27.0 is the
  default `xcode-select` toolchain, so point builds at 27.1 explicitly:

  ```sh
  export DEVELOPER_DIR="/Applications/Xcode copy.app/Contents/Developer"
  bunx expo run:ios --device "<iPhone Duo simulator UDID>"
  ```

  Verify the slice you got: the clang invocations should show
  `-target-sdk-version=27.1` and `iPhoneSimulator27.1.sdk`.

- **EAS Build cannot do this yet.** The newest iOS image (`latest` →
  `macos-tahoe-26.5-xcode-26.6`) is Xcode 26.6, which is an iOS 26 SDK. A cloud
  build today produces a binary that runs in the *basic* letterboxed mode on Duo.
  Pin `eas.json` to the Xcode 27 image once Expo publishes one; until then, a
  Duo-optimized App Store build has to come from a local archive.

## Layout rules

iOS 27 makes iPhone apps resizable and requires the scene-based lifecycle. `expo prebuild`
generates `ios/MeetCal/SceneDelegate.swift` and the `UIApplicationSceneManifest` entry
for us — nothing to hand-maintain, as long as `AppDelegate.swift` stays unmodified.

- Size, never orientation. `orientation: 'portrait'` in `app.config.js` is only honoured
  on the outer display; the inner display ignores supported interface orientations.
  Branch on width from `useWindowDimensions()`, not on portrait/landscape.
- `ios.requireFullScreen` stays unset (false). On iOS 27 it no longer opts out of
  resizing, and setting it would only cost us Split View.
- **Honour `insets.left` / `insets.right`, not just top and bottom.** The Duo
  reserves an 84pt band on one side (466pt window → 382pt of usable width) and
  puts the status items *and* the floating tab rail there. `useSafeAreaInsets()`
  already reports it; a screen that ignores it renders underneath. The band is
  device-level, so it applies to pushed screens with no tab bar too.

  Screens apply it at their outermost container via
  `useScreenHorizontalInsets()` (`hooks/useScreenInsets.ts`), which returns
  `{ paddingLeft, paddingRight }`. Inner padding then sits inside the safe band
  the way layout margins do on iOS.

- **Apply it once per subtree.** Chrome rendered *inside* a screen (for example
  `PageIndicator`) inherits the screen's padding and must not add it again, or it
  ends up off-centre. Chrome mounted in `app/_layout.tsx` above the screens
  (`Toast`, `OfflineIndicator`) spans the whole window and does need it.

- **Anything that measures the window must use the usable width.**
  `usePaginatedSchedule` derives `pageWidth = windowWidth - insets.left - insets.right`
  and the schedule screen sizes its pages and `getItemLayout` from that. Paging off
  the raw window width snaps 466pt at a time through a 382pt viewport and lands
  between days. The hook also re-anchors on the current page whenever that width
  changes (fold, unfold, Split View); see `hooks/usePaginatedSchedule.test.tsx`.

- **Clamp anchored overlays to the safe area.** `FilterPillBar` positions its menu
  against `windowWidth - insets.right` rather than the raw window edge.

## Testing

The `iPhone Duo` simulator (iOS 27.1) exercises the folded, open, and rotated poses.
Fold/unfold from the simulator's device controls and confirm:

- the schedule pager stays on the same day,
- no content lands under the hinge or outside the safe area,
- filter menus anchored with `measureInWindow` still line up with their pill.
