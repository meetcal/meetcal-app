import { createSplashGate, splashHideReason, SPLASH_HOLD_MAX_MS } from "@/lib/startup-splash";
import { createStartupTiming } from "@/lib/startup-timing";

function setup(startElapsedMs = 0) {
  let now = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let nextId = 1;
  const deps = {
    now: () => now,
    setTimer: (callback: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, callback });
      return id;
    },
    clearTimer: (handle: unknown) => {
      timers.delete(handle as number);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) {
        timers.delete(id);
        timer.callback();
      }
    }
  };
  const timing = createStartupTiming(deps);
  now += startElapsedMs;
  const gate = createSplashGate({ timing, setTimer: deps.setTimer, clearTimer: deps.clearTimer });
  const hide = jest.fn(async () => undefined);
  return { timing, gate, hide, advance, pendingTimers: () => timers.size };
}

describe("splashHideReason", () => {
  const holding = {
    elapsedMs: 0,
    firstScreen: null,
    onScheduleRoute: null,
    overlayShown: false,
  } as const;

  it("holds while the Schedule tab is still loading, inside the cap", () => {
    expect(splashHideReason(holding)).toBeNull();
    expect(splashHideReason({ ...holding, onScheduleRoute: true, elapsedMs: SPLASH_HOLD_MAX_MS - 1 })).toBeNull();
  });

  it("hides for a settled first screen, whatever it is", () => {
    for (const firstScreen of ["schedule", "empty-schedule", "no-meet", "error", "onboarding"] as const) {
      expect(splashHideReason({ ...holding, firstScreen })).toBe("screen");
    }
  });

  it("hides at once for another route or a root dialog", () => {
    expect(splashHideReason({ ...holding, onScheduleRoute: false })).toBe("other-route");
    expect(splashHideReason({ ...holding, overlayShown: true })).toBe("overlay");
  });

  it("hides at the cap", () => {
    expect(splashHideReason({ ...holding, elapsedMs: SPLASH_HOLD_MAX_MS })).toBe("cap");
    expect(splashHideReason({ ...holding, elapsedMs: 10, holdMaxMs: 10 })).toBe("cap");
  });
});

describe("splash gate", () => {
  it("holds the splash until the first screen settles, then hides it once", () => {
    const { timing, gate, hide, advance, pendingTimers } = setup();
    gate.arm(hide);
    gate.setRoute(true);
    advance(400);
    expect(hide).not.toHaveBeenCalled();

    timing.firstScreen("schedule");
    expect(hide).toHaveBeenCalledTimes(1);
    expect(gate.isHidden()).toBe(true);
    expect(timing.properties()).toMatchObject({
      splash_hidden_ms: 400,
      splash_hide_reason: "screen",
    });
    // The cap timer is gone, and nothing hides it again.
    expect(pendingTimers()).toBe(0);
    gate.showOverlay();
    gate.setRoute(false);
    advance(SPLASH_HOLD_MAX_MS);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("hides at the cap when nothing settles (a fresh install, a hung load)", () => {
    const { timing, gate, hide, advance } = setup();
    gate.arm(hide);
    gate.setRoute(true);
    advance(SPLASH_HOLD_MAX_MS - 1);
    expect(hide).not.toHaveBeenCalled();
    advance(1);
    expect(hide).toHaveBeenCalledTimes(1);
    expect(timing.properties().splash_hide_reason).toBe("cap");
  });

  it("counts the cap from JS start, so a late arm hides sooner", () => {
    const { gate, hide, advance } = setup(SPLASH_HOLD_MAX_MS - 100);
    gate.arm(hide);
    advance(99);
    expect(hide).not.toHaveBeenCalled();
    advance(1);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("hides at once when armed after the cap has already passed", () => {
    const { gate, hide } = setup(SPLASH_HOLD_MAX_MS + 1);
    gate.arm(hide);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("hides for a launch on another route, or for the update prompt", () => {
    const deepLink = setup();
    deepLink.gate.arm(deepLink.hide);
    deepLink.gate.setRoute(false);
    expect(deepLink.hide).toHaveBeenCalledTimes(1);
    expect(deepLink.timing.properties().splash_hide_reason).toBe("other-route");

    const update = setup();
    update.gate.arm(update.hide);
    update.gate.showOverlay();
    expect(update.hide).toHaveBeenCalledTimes(1);
    expect(update.timing.properties().splash_hide_reason).toBe("overlay");
  });

  it("does nothing before it is armed (a screen rendered in a test)", () => {
    const { timing, gate, hide } = setup();
    timing.firstScreen("schedule");
    gate.setRoute(false);
    gate.showOverlay();
    expect(gate.isHidden()).toBe(false);
    // Armed later, it sees what already happened.
    gate.arm(hide);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("swallows a hide that rejects or throws", async () => {
    const rejecting = setup();
    rejecting.gate.arm(jest.fn(async () => {
      throw new Error("No native splash screen registered");
    }));
    expect(() => rejecting.timing.firstScreen("no-meet")).not.toThrow();
    await Promise.resolve();

    const throwing = setup();
    throwing.gate.arm(() => {
      throw new Error("sync");
    });
    expect(() => throwing.timing.firstScreen("no-meet")).not.toThrow();
    expect(throwing.gate.isHidden()).toBe(true);
  });
});
