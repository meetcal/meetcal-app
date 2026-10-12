import type { Href } from "expo-router";
import { isInternalRoutePath } from "@/utils/deepLinks";

/** The slice of expo-router's router that leaving sign-in or the paywall uses. */
export interface OriginRouter {
  dismissTo: (href: Href) => void;
  replace: (href: Href) => void;
  back: () => void;
  canGoBack: () => boolean;
}

export const DEFAULT_ORIGIN: Href = "/(tabs)/(index)";

/** `from` as an in-app href, or null when it is missing or could leave the app. */
export function originHref(from: unknown): Href | null {
  // `isInternalRoutePath` has proved it is an absolute in-app path; `Href`'s
  // typed-routes union cannot be checked at runtime past that.
  return isInternalRoutePath(from) ? (from as Href) : null;
}

/**
 * Leave sign-in or the routed paywall for the screen the user came from.
 *
 * Both are pushed on top of `from`. `router.replace(from)` swapped the top
 * screen for a *second* copy of `from`, so Back landed on the stale original
 * (`[tabs, details, details']`), and returning to a tab mounted a second tabs
 * navigator over the first. `dismissTo` pops back to the existing `from` and
 * only replaces the top screen when `from` is not on the stack (sign-in that
 * replaced an inline paywall, or the profile reached through sign-in). The
 * paywall used the opposite order (back first), so the two disagreed about
 * where "back" was.
 */
export function returnToOrigin(
  router: OriginRouter,
  from: unknown,
  fallback: Href = DEFAULT_ORIGIN,
): void {
  const href = originHref(from);
  if (href) {
    router.dismissTo(href);
    return;
  }
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(fallback);
}
