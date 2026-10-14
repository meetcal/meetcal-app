import { useCallback, useEffect, useRef } from "react";

import type { ResourceSource } from "@/lib/data/mutable-resource";
import {
  scheduleScreenOutcome,
  startupTiming,
  type ScheduleScreenState,
  type StartupTiming,
} from "@/lib/startup-timing";

/**
 * Reports the Schedule tab's first settled state to the startup timing (and
 * through it to the splash, `lib/startup-splash.ts`). Only the process's
 * first screen counts; later renders, meet switches and remounts are ignored.
 *
 * Returns the `onLayout` for the day list: a schedule counts as shown once
 * the list has laid out, not when its data arrives.
 */
export function useStartupScreenReport(
  state: ScheduleScreenState,
  scheduleSource: ResourceSource | null,
  timing: StartupTiming = startupTiming,
): () => void {
  const outcome = scheduleScreenOutcome(state);
  const sourceRef = useRef(scheduleSource);
  sourceRef.current = scheduleSource;

  useEffect(() => {
    if (timing.outcome() !== null) return;
    if (outcome === "schedule") {
      if (scheduleSource === "cache") timing.mark("schedulePaintedFromCache");
      return;
    }
    if (outcome !== "pending") timing.firstScreen(outcome);
  }, [outcome, scheduleSource, timing]);

  return useCallback(() => {
    if (timing.outcome() !== null) return;
    timing.setFlags({ scheduleCacheHit: sourceRef.current === "cache" });
    timing.mark("firstScheduleContent");
    timing.firstScreen("schedule");
  }, [timing]);
}
