import { useSegments } from "expo-router";
import { useEffect } from "react";

import { isScheduleRoute, splashGate, type SplashGate } from "@/lib/startup-splash";

/**
 * Tells the launch splash whether the visible route is the Schedule tab
 * (`lib/startup-splash.ts`). A leaf of its own: reading the route re-renders
 * whatever reads it on every navigation, and the root layout reading it
 * re-rendered every provider and the root Stack for the rest of the session.
 * Once the splash is down the route no longer matters.
 */
export function SplashRouteReporter({ gate = splashGate }: { gate?: SplashGate }) {
  const onSchedule = isScheduleRoute(useSegments() as readonly string[]);

  useEffect(() => {
    if (onSchedule === null || gate.isHidden()) return;
    gate.setRoute(onSchedule);
  }, [gate, onSchedule]);

  return null;
}
