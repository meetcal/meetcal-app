import {
  startupTiming,
  type SplashHideReason,
  type StartupOutcome,
  type StartupTiming,
} from "@/lib/startup-timing";

/**
 * When the native splash comes down on a cold start.
 *
 * It used to hide as soon as the root layout mounted, before any data, so a
 * warm start showed "Loading meets..." and then "Loading schedule..."
 * skeletons for the moment it took to read the offline copies. It now stays
 * up until the first screen has settled: the schedule's day list is laid out
 * (from the offline copy on a warm start), or an empty schedule, no-meet,
 * error or onboarding screen shows. A launch on another route (a deep link,
 * sign-in) or a root dialog (the update prompt) hides it at once.
 *
 * Whatever happens, it comes down `SPLASH_HOLD_MAX_MS` after JS start: a
 * fresh install or a cold cache then shows the skeletons as before. The
 * timer is armed at module scope in `app/_layout.tsx`, outside React, so a
 * render that throws or never finishes cannot keep the splash up.
 */
export const SPLASH_HOLD_MAX_MS = 1500;

export type SplashHoldState = {
  /** Ms since JS start. */
  elapsedMs: number;
  /** The first screen once it has settled, else null. */
  firstScreen: StartupOutcome | null;
  /** Whether the visible route is the Schedule tab; null before the router says. */
  onScheduleRoute: boolean | null;
  /** A root dialog wants to be seen. */
  overlayShown: boolean;
  holdMaxMs?: number;
};

/** Why the splash should come down now, or null to keep holding it. */
export function splashHideReason(state: SplashHoldState): SplashHideReason | null {
  if (state.firstScreen !== null) return "screen";
  if (state.overlayShown) return "overlay";
  if (state.onScheduleRoute === false) return "other-route";
  if (state.elapsedMs >= (state.holdMaxMs ?? SPLASH_HOLD_MAX_MS)) return "cap";
  return null;
}

export type SplashGateDeps = {
  timing: StartupTiming;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  holdMaxMs?: number;
};

export type SplashGate = ReturnType<typeof createSplashGate>;

export function createSplashGate(deps: SplashGateDeps) {
  const holdMaxMs = deps.holdMaxMs ?? SPLASH_HOLD_MAX_MS;
  let armed = false;
  let hidden = false;
  let onScheduleRoute: boolean | null = null;
  let overlayShown = false;
  let capTimer: unknown = null;
  let unsubscribe: (() => void) | null = null;
  let hide: () => Promise<unknown> | unknown = () => undefined;

  function hideNow(reason: SplashHideReason) {
    if (hidden) return;
    hidden = true;
    if (capTimer !== null) {
      deps.clearTimer(capTimer);
      capTimer = null;
    }
    unsubscribe?.();
    unsubscribe = null;
    deps.timing.overrideFlags({ splashHideReason: reason });
    deps.timing.mark("splashHidden");
    try {
      // A second hide, or one with no splash registered, rejects; the
      // splash is down either way.
      void Promise.resolve(hide()).catch(() => undefined);
    } catch {
      // Same, thrown synchronously.
    }
  }

  function evaluate() {
    if (!armed || hidden) return;
    const reason = splashHideReason({
      elapsedMs: deps.timing.elapsed(),
      firstScreen: deps.timing.outcome(),
      onScheduleRoute,
      overlayShown,
      holdMaxMs,
    });
    if (reason) hideNow(reason);
  }

  return {
    /**
     * Starts the hold and its cap. Call once, at module scope; `hideSplash`
     * is `SplashScreen.hideAsync`.
     */
    arm(hideSplash: () => Promise<unknown> | unknown) {
      if (armed) return;
      armed = true;
      hide = hideSplash;
      unsubscribe = deps.timing.subscribe(evaluate);
      capTimer = deps.setTimer(() => {
        capTimer = null;
        hideNow("cap");
      }, Math.max(0, holdMaxMs - deps.timing.elapsed()));
      evaluate();
    },
    /** The router's current route: whether it is the Schedule tab. */
    setRoute(isScheduleRoute: boolean) {
      onScheduleRoute = isScheduleRoute;
      evaluate();
    },
    /** A root dialog is showing and must not sit behind the splash. */
    showOverlay() {
      overlayShown = true;
      evaluate();
    },
    isHidden: () => hidden,
  };
}

/** This process's splash. Armed by `app/_layout.tsx`. */
export const splashGate = createSplashGate({
  timing: startupTiming,
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
});
