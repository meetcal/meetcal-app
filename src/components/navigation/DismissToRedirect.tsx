import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback } from "react";

/**
 * `<Redirect>` that pops back to `href` instead of replacing the top screen.
 *
 * `<Redirect>` calls `router.replace`. When the redirecting route was pushed
 * on top of the app (a widget link, an unmatched deep link, the auth group
 * for a user who is already signed in), replacing it with a tab added a
 * *second* tabs navigator over the first: every tab's effects and fetches
 * mounted again, and Back revealed the stale copy. `dismissTo` pops back to
 * the existing tabs, and only replaces the top screen when `href` is not on
 * the stack (a cold start straight into the link). See
 * `utils/returnToOrigin.ts` for the same fix on sign-in and the paywall.
 */
export function DismissToRedirect({ href }: { href: Href }): null {
  const router = useRouter();
  useFocusEffect(
    useCallback(() => {
      try {
        router.dismissTo(href);
      } catch (error) {
        console.error("[DismissToRedirect] navigation failed", error);
      }
    }, [router, href]),
  );
  return null;
}
