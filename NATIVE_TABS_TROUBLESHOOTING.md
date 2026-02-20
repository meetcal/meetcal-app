# Native Tabs Icon Crash Troubleshooting

## Issue Summary

On iOS, app startup can fail with:

`[RNScreens] Incorrect icon format. You must provide sfSymbolName, imageSource or templateSource.`

The stack usually points to `app/(tabs)/_layout.tsx` and `<NativeTabs />`.

## Why This Happens

`react-native-screens` validates tab icon objects strictly.

Valid icon shapes are:

- `{ sfSymbolName: "..." }`
- `{ imageSource: ... }`
- `{ templateSource: ... }`

If `expo-router` passes any other shape (or `undefined`), `react-native-screens` throws this error.

In this project, the failure was caused by a modified local package file:

- `node_modules/expo-router/build/native-tabs/NativeBottomTabs/NativeTabsView.js`

The broken local code returned icon objects like:

- `{ ios: { type: "sfSymbol", ... } }`
- `{ shared: { type: "imageSource", ... } }`

Those formats are invalid for `react-native-screens`.

## Symptoms to Confirm

1. Error appears right when rendering `NativeTabs`.
2. `app/(tabs)/_layout.tsx` can look correct (`<Icon sf="..." />`) but still crashes.
3. Problem persists across normal app reruns because it is in local package runtime code.

## Fast Local Fix (Hotfix)

Patch `node_modules/expo-router/build/native-tabs/NativeBottomTabs/NativeTabsView.js`:

- For SF icon return:
  - `return { sfSymbolName: icon.sf };`
- For image icon return:
  - `return { templateSource: icon.src };`

Then clear cache and rerun:

1. `bunx expo start -c`
2. `bunx expo run:ios`

## Recommended Durable Fix

Do not rely on manual `node_modules` edits long term.

Use one of these:

1. Reinstall clean package:
   - `bun add expo-router@~6.0.14`
2. Keep a reproducible patch workflow so installs/builds apply the same fix automatically.
3. Upgrade to a package version where the issue is fixed upstream.

## Notes

- This error can happen even when app code is unchanged.
- If NativeTabs suddenly breaks after tooling/config changes, inspect installed package runtime files first.
- Temporary local package edits are fine for debugging, but not reliable for CI/EAS/teammates unless made reproducible.
