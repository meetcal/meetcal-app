import type { Href } from "expo-router";

import { useRedirectIntoTabs } from "@/lib/tab-redirect";

/**
 * `<Redirect>` that pops back to `href` instead of replacing the top screen,
 * for routes that decide while rendering whether to leave (the auth group for
 * a user who is already signed in, the OAuth callback).
 *
 * `<Redirect>` calls `router.replace`. When the redirecting route was pushed
 * on top of the app, replacing it with a tab added a *second* tabs navigator
 * over the first: every tab's effects and fetches mounted again, and Back
 * revealed the stale copy. `useRedirectIntoTabs` (`lib/tab-redirect.ts`) pops
 * back to the existing tabs, and only replaces the top screen when `href` is
 * not on the stack (a cold start straight into the route). See
 * `utils/returnToOrigin.ts` for the same fix on sign-in and the paywall.
 */
export function DismissToRedirect({ href }: { href: Href }): null {
  useRedirectIntoTabs(href);
  return null;
}
