import React from "react";
import { act, create } from "react-test-renderer";

import { useStartupScreenReport } from "@/hooks/useStartupScreenReport";
import type { ResourceSource } from "@/lib/data/mutable-resource";
import { createStartupTiming, type ScheduleScreenState, type StartupTiming } from "@/lib/startup-timing";

const loadingMeets: ScheduleScreenState = {
  onboardingShowing: false,
  meetsLoading: true,
  hasMeet: false,
  scheduleLoading: false,
  changingMeet: false,
  scheduleDays: 0,
  loadFailed: false,
};

let onLayout: (() => void) | null = null;

function Probe({
  state,
  source,
  timing,
}: {
  state: ScheduleScreenState;
  source: ResourceSource | null;
  timing: StartupTiming;
}) {
  const handler = useStartupScreenReport(state, source, timing);
  // After commit, not during render (see `SelectedMeetContext.test.tsx`).
  React.useEffect(() => {
    onLayout = handler;
  });
  return null;
}

function setup() {
  let now = 0;
  const timing = createStartupTiming({
    now: () => now,
    setTimer: () => 0,
    clearTimer: () => undefined,
  });
  let tree!: ReturnType<typeof create>;
  const render = (state: ScheduleScreenState, source: ResourceSource | null = null) => {
    act(() => {
      if (tree) tree.update(<Probe state={state} source={source} timing={timing} />);
      else tree = create(<Probe state={state} source={source} timing={timing} />);
    });
  };
  return {
    timing,
    render,
    tick: (ms: number) => {
      now += ms;
    },
    unmount: () => act(() => tree.unmount()),
  };
}

describe("useStartupScreenReport", () => {
  it("counts a cached schedule once its day list has laid out", () => {
    const { timing, render, tick, unmount } = setup();
    render(loadingMeets);
    tick(100);
    render({ ...loadingMeets, meetsLoading: false, hasMeet: true, scheduleLoading: true });
    expect(timing.outcome()).toBeNull();

    tick(50);
    render(
      { ...loadingMeets, meetsLoading: false, hasMeet: true, scheduleDays: 4, scheduleLoading: false },
      "cache",
    );
    // Rendered, but not laid out yet.
    expect(timing.outcome()).toBeNull();
    expect(timing.properties().schedule_cached_ms).toBe(150);

    tick(20);
    act(() => onLayout?.());
    expect(timing.outcome()).toBe("schedule");
    expect(timing.properties()).toMatchObject({
      schedule_content_ms: 170,
      first_screen_ms: 170,
      schedule_cache_hit: true,
    });
    unmount();
  });

  it("reports a schedule that came from the network as a cache miss", () => {
    const { timing, render, unmount } = setup();
    render({ ...loadingMeets, meetsLoading: false, hasMeet: true, scheduleDays: 2 }, "network");
    act(() => onLayout?.());
    expect(timing.properties()).toMatchObject({
      outcome: "schedule",
      schedule_cache_hit: false,
      schedule_cached_ms: null,
    });
    unmount();
  });

  it("settles on the empty, no-meet, error and onboarding screens without a layout", () => {
    for (const [state, outcome] of [
      [{ ...loadingMeets, meetsLoading: false }, "no-meet"],
      [{ ...loadingMeets, meetsLoading: false, hasMeet: true }, "empty-schedule"],
      [{ ...loadingMeets, meetsLoading: false, hasMeet: true, loadFailed: true }, "error"],
      [{ ...loadingMeets, onboardingShowing: true }, "onboarding"],
    ] as const) {
      const { timing, render, unmount } = setup();
      render(state);
      expect(timing.outcome()).toBe(outcome);
      unmount();
    }
  });

  it("ignores everything after the first screen", () => {
    const { timing, render, unmount } = setup();
    render({ ...loadingMeets, meetsLoading: false });
    expect(timing.outcome()).toBe("no-meet");

    render({ ...loadingMeets, meetsLoading: false, hasMeet: true, scheduleDays: 3 }, "cache");
    act(() => onLayout?.());
    expect(timing.outcome()).toBe("no-meet");
    expect(timing.properties()).toMatchObject({
      schedule_cached_ms: null,
      schedule_content_ms: null,
      schedule_cache_hit: null,
    });
    unmount();
  });
});
