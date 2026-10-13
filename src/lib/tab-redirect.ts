import type { Href } from "expo-router";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback } from "react";

/**
 * Sends a linked route that only forwards to a tab (`/open/saved`,
 * `+not-found`) into the tabs already under it. `<Redirect>` replaces the
 * linked route with a second root `(tabs)` route, so the stack held two tab
 * navigators and Back led from one to the other. `dismissTo` pops back to
 * the existing `(tabs)` and opens the tab there, or replaces when none is
 * underneath.
 */
export function useRedirectIntoTabs(href: Href): void {
  const router = useRouter();
  useFocusEffect(
    useCallback(() => {
      router.dismissTo(href);
    }, [href, router]),
  );
}
