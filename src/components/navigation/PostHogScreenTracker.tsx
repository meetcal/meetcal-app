import { usePathname } from "expo-router";
import { useEffect } from "react";

import { posthog } from "@/lib/posthog";

/**
 * Sends a `$screen` event for each route the user lands on.
 *
 * PostHog's own screen autocapture (`autocapture.captureScreens`) reads React
 * Navigation's container, which expo-router does not expose: mounted above
 * the navigator it found no navigation object, logged two errors on every
 * launch and tracked nothing. PostHog's Expo Router guidance is to turn that
 * off and report the pathname instead. Mount this inside the root layout,
 * where expo-router's `usePathname` works.
 */
export function PostHogScreenTracker(): null {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    void posthog.screen(pathname).catch((error: unknown) => {
      if (__DEV__) console.warn("[posthog] screen capture failed", error);
    });
  }, [pathname]);

  return null;
}
