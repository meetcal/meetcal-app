/**
 * The root stack's expo-router settings, exported by `app/_layout.tsx` as
 * `unstable_settings`. Kept here so a test can build the route tree with them
 * (a module under `app/` would itself become a route).
 *
 * `anchor`: the route every deep link opens on top of. Without it, a link
 * that cold-starts the app (a widget row, a calendar event's URL, a push)
 * builds a root stack holding only the linked screen: no Back, no
 * edge-swipe, no tab bar, and on iOS no way out but force-quitting. With it,
 * the tabs sit under the linked screen, so Back returns to the Schedule tab.
 */
export const ROOT_STACK_SETTINGS = { anchor: "(tabs)" } as const;
