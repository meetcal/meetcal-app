import {
  createStartupTiming,
  scheduleScreenOutcome,
  STARTUP_TIMING_EVENT,
  STARTUP_TIMING_MAX_WAIT_MS,
  type ScheduleScreenState,
  type StartupTimingProperties,
} from "@/lib/startup-timing";

/** A clock and timer queue the test moves by hand. */
function fakeDeps(start = 1000) {
  let now = start;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let nextId = 1;
  return {
    deps: {
      now: () => now,
      setTimer: (callback: () => void, ms: number) => {
        const id = nextId++;
        timers.set(id, { at: now + ms, callback });
        return id;
      },
      clearTimer: (handle: unknown) => {
        timers.delete(handle as number);
      },
    },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
    pendingTimers: () => timers.size,
  };
}

function setup() {
  const clock = fakeDeps();
  const timing = createStartupTiming(clock.deps);
  const sent: { event: string; properties: StartupTimingProperties }[] = [];
  const begin = (maxWaitMs?: number) =>
    timing.begin((event, properties) => sent.push({ event, properties }), maxWaitMs);
  return { clock, timing, sent, begin };
}

describe("startup timing", () => {
  it("sends one event once the splash is down and the first screen has settled", () => {
    const { clock, timing, sent, begin } = setup();
    begin();
    timing.setFlags({ platform: "ios", nativeTabs: true, updateLaunch: false });

    clock.advance(120);
    timing.setFlags({ meetsCacheHit: true, neededMeetLookup: false });
    timing.mark("meetsPaintedFromCache");
    clock.advance(80);
    timing.mark("schedulePaintedFromCache");
    clock.advance(30);
    timing.setFlags({ scheduleCacheHit: true });
    timing.mark("firstScheduleContent");
    timing.firstScreen("schedule");
    expect(sent).toHaveLength(0);

    clock.advance(5);
    timing.overrideFlags({ splashHideReason: "screen" });
    timing.mark("splashHidden");

    expect(sent).toHaveLength(1);
    expect(sent[0].event).toBe(STARTUP_TIMING_EVENT);
    expect(sent[0].properties).toEqual({
      outcome: "schedule",
      complete: true,
      reported_at_ms: 235,
      splash_hidden_ms: 235,
      meets_cached_ms: 120,
      schedule_cached_ms: 200,
      schedule_content_ms: 230,
      first_screen_ms: 230,
      meets_cache_hit: true,
      schedule_cache_hit: true,
      needed_meet_lookup: false,
      native_tabs: true,
      platform: "ios",
      update_launch: false,
      app_state_at_start: null,
      backgrounded: null,
      splash_hide_reason: "screen",
    });
    // The give-up timer is cleared.
    expect(clock.pendingTimers()).toBe(0);

    // Nothing after the send changes or resends it.
    timing.mark("firstScheduleContent");
    timing.firstScreen("no-meet");
    clock.advance(STARTUP_TIMING_MAX_WAIT_MS);
    expect(sent).toHaveLength(1);
  });

  it("still reports a launch that never settles, after the wait, marked incomplete", () => {
    const { clock, timing, sent, begin } = setup();
    begin();
    timing.mark("splashHidden");

    clock.advance(STARTUP_TIMING_MAX_WAIT_MS - 1);
    expect(sent).toHaveLength(0);
    clock.advance(1);

    expect(sent).toHaveLength(1);
    expect(sent[0].properties).toMatchObject({
      complete: false,
      outcome: null,
      splash_hidden_ms: 0,
      first_screen_ms: null,
      schedule_content_ms: null,
      reported_at_ms: STARTUP_TIMING_MAX_WAIT_MS,
    });
  });

  it("counts the wait from JS start, not from when the report was armed", () => {
    const { clock, sent, begin } = setup();
    clock.advance(1000);
    begin(5000);
    clock.advance(3999);
    expect(sent).toHaveLength(0);
    clock.advance(1);
    expect(sent).toHaveLength(1);
  });

  it("holds marks taken before it is armed and sends at once if already complete", () => {
    const { timing, sent, begin } = setup();
    timing.firstScreen("no-meet");
    timing.mark("splashHidden");
    expect(sent).toHaveLength(0);

    begin();
    expect(sent).toHaveLength(1);
    expect(sent[0].properties.outcome).toBe("no-meet");
  });

  it("keeps the first answer for a flag, a mark and the first screen", () => {
    const { clock, timing } = setup();
    timing.setFlags({ meetsCacheHit: false });
    timing.setFlags({ meetsCacheHit: true });
    timing.mark("meetsPaintedFromCache");
    clock.advance(50);
    timing.mark("meetsPaintedFromCache");
    timing.firstScreen("onboarding");
    timing.firstScreen("schedule");

    expect(timing.properties()).toMatchObject({
      meets_cache_hit: false,
      meets_cached_ms: 0,
      outcome: "onboarding",
    });
    timing.overrideFlags({ backgrounded: true });
    expect(timing.properties().backgrounded).toBe(true);
  });

  it("wakes whoever waits for the first screen, and anyone asking later at once", async () => {
    const { timing } = setup();
    let woke = false;
    const waiting = timing.whenFirstScreen().then(() => {
      woke = true;
    });
    await Promise.resolve();
    expect(woke).toBe(false);

    timing.firstScreen("empty-schedule");
    await waiting;
    expect(woke).toBe(true);
    await expect(timing.whenFirstScreen()).resolves.toBeUndefined();
  });

  it("tells subscribers about the first screen and the splash, and survives a bad one", () => {
    const { timing } = setup();
    const heard: string[] = [];
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    timing.subscribe(() => {
      throw new Error("listener failed");
    });
    const unsubscribe = timing.subscribe(() => heard.push(timing.outcome() ?? "none"));

    timing.mark("meetsPaintedFromCache");
    timing.mark("splashHidden");
    timing.firstScreen("error");
    unsubscribe();
    timing.firstScreen("schedule");

    expect(heard).toEqual(["none", "error"]);
    warn.mockRestore();
  });

  it("does not throw when sending fails", () => {
    const { timing } = setup();
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    timing.begin(() => {
      throw new Error("posthog down");
    });
    timing.firstScreen("no-meet");
    expect(() => timing.mark("splashHidden")).not.toThrow();
    expect(timing.isSent()).toBe(true);
    warn.mockRestore();
  });
});

describe("scheduleScreenOutcome", () => {
  const base: ScheduleScreenState = {
    onboardingShowing: false,
    meetsLoading: false,
    resolvingStoredMeet: false,
    hasMeet: true,
    scheduleLoading: false,
    changingMeet: false,
    scheduleDays: 3,
    loadFailed: false,
  };

  it.each<[string, Partial<ScheduleScreenState>, ReturnType<typeof scheduleScreenOutcome>]>([
    ["the day list", {}, "schedule"],
    ["the tour, over anything", { onboardingShowing: true, meetsLoading: true }, "onboarding"],
    ["the meets skeleton", { meetsLoading: true }, "pending"],
    ["no meet", { hasMeet: false, scheduleDays: 0 }, "no-meet"],
    [
      "no meet yet while the stored meet is looked up",
      { hasMeet: false, scheduleDays: 0, resolvingStoredMeet: true },
      "pending",
    ],
    ["a meet found while the lookup winds down", { resolvingStoredMeet: true }, "schedule"],
    ["the schedule skeleton", { scheduleLoading: true, scheduleDays: 0 }, "pending"],
    ["a cached schedule while it revalidates", { scheduleLoading: true }, "schedule"],
    ["a meet switch", { changingMeet: true }, "pending"],
    ["no schedule yet", { scheduleDays: 0 }, "empty-schedule"],
    ["a failed load with nothing cached", { scheduleDays: 0, loadFailed: true }, "error"],
  ])("%s", (_label, overrides, expected) => {
    expect(scheduleScreenOutcome({ ...base, ...overrides })).toBe(expected);
  });
});
