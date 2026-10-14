/**
 * How long a cold start takes to show something useful, measured in release
 * builds and sent once per process as the PostHog event `startup_timing`.
 *
 * Every time is in ms since this module was evaluated, which `app/_layout.tsx`
 * makes the first thing it imports, so 0 is "the JS bundle started running
 * the app" (the native launch and bundle load before it are not counted).
 *
 * The event goes out once the splash is down and the first screen has
 * settled (the schedule's day list laid out, or an empty, no-meet, error,
 * onboarding or other-route screen shown). A launch that never gets there
 * (stuck on a skeleton, put in the background) still reports after
 * `STARTUP_TIMING_MAX_WAIT_MS` with what it has and `complete: false`.
 */

export const STARTUP_TIMING_EVENT = "startup_timing";
/** After this the event is sent with whatever marks exist. */
export const STARTUP_TIMING_MAX_WAIT_MS = 30_000;

/** Points on the way to the first useful screen. */
export type StartupMark =
  /** The native splash was asked to hide. */
  | "splashHidden"
  /** The cached meets list was handed to the screens (before any request). */
  | "meetsPaintedFromCache"
  /** The schedule tab rendered its day list from the offline copy. */
  | "schedulePaintedFromCache"
  /** The schedule tab's day list was laid out (first `onLayout`). */
  | "firstScheduleContent"
  /** The first screen the user can act on, whatever it is. */
  | "firstScreen";

/** What the first useful screen was. */
export type StartupOutcome =
  | "schedule"
  | "empty-schedule"
  | "no-meet"
  | "error"
  | "onboarding"
  | "other-route";

/** Why the splash came down. */
export type SplashHideReason =
  /** The first screen settled (see `StartupOutcome`). */
  | "screen"
  /** The app opened on a route other than the schedule (a deep link, sign-in). */
  | "other-route"
  /** A root dialog (the update prompt) needs to be seen. */
  | "overlay"
  /** `SPLASH_HOLD_MAX_MS` passed first. */
  | "cap";

export type StartupFlags = {
  /** The meets list was on disk. */
  meetsCacheHit?: boolean;
  /** The first schedule drawn came from the offline copy. */
  scheduleCacheHit?: boolean;
  /** The stored meet was not in the cached list and had to be looked up by name. */
  neededMeetLookup?: boolean;
  /** iOS 26+ `NativeTabs` (`lib/tab-bar-layout.ts`). */
  nativeTabs?: boolean;
  platform?: string;
  /** Running a downloaded OTA update rather than the embedded bundle. */
  updateLaunch?: boolean;
  /** `AppState.currentState` when JS started ("background" for a background launch). */
  appStateAtStart?: string;
  /** The app went to the background before the event was sent. */
  backgrounded?: boolean;
  splashHideReason?: SplashHideReason;
};

export type StartupTimingProperties = Record<string, string | number | boolean | null>;

export type StartupTimingDeps = {
  /** Monotonic ms. */
  now: () => number;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
};

export type StartupTiming = ReturnType<typeof createStartupTiming>;

const MARK_PROPERTIES: Record<StartupMark, string> = {
  splashHidden: "splash_hidden_ms",
  meetsPaintedFromCache: "meets_cached_ms",
  schedulePaintedFromCache: "schedule_cached_ms",
  firstScheduleContent: "schedule_content_ms",
  firstScreen: "first_screen_ms",
};

const FLAG_PROPERTIES: Record<keyof StartupFlags, string> = {
  meetsCacheHit: "meets_cache_hit",
  scheduleCacheHit: "schedule_cache_hit",
  neededMeetLookup: "needed_meet_lookup",
  nativeTabs: "native_tabs",
  platform: "platform",
  updateLaunch: "update_launch",
  appStateAtStart: "app_state_at_start",
  backgrounded: "backgrounded",
  splashHideReason: "splash_hide_reason",
};

export function createStartupTiming(deps: StartupTimingDeps) {
  const origin = deps.now();
  const marks: Partial<Record<StartupMark, number>> = {};
  const flags: StartupFlags = {};
  let outcome: StartupOutcome | null = null;
  let send: ((event: string, properties: StartupTimingProperties) => void) | null = null;
  let sent = false;
  let capTimer: unknown = null;
  const listeners = new Set<() => void>();
  const screenWaiters: (() => void)[] = [];

  const elapsed = () => Math.max(0, Math.round(deps.now() - origin));

  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.warn("[startup] listener failed", error);
      }
    }
  };

  const isComplete = () => marks.splashHidden !== undefined && marks.firstScreen !== undefined;

  function properties(): StartupTimingProperties {
    const props: StartupTimingProperties = {
      outcome,
      complete: isComplete(),
      reported_at_ms: elapsed(),
    };
    for (const [mark, name] of Object.entries(MARK_PROPERTIES) as [StartupMark, string][]) {
      props[name] = marks[mark] ?? null;
    }
    for (const [flag, name] of Object.entries(FLAG_PROPERTIES) as [keyof StartupFlags, string][]) {
      const value = flags[flag];
      props[name] = value === undefined ? null : value;
    }
    return props;
  }

  function flush() {
    if (sent || !send) return;
    sent = true;
    if (capTimer !== null) {
      deps.clearTimer(capTimer);
      capTimer = null;
    }
    try {
      send(STARTUP_TIMING_EVENT, properties());
    } catch (error) {
      console.warn("[startup] failed to send startup timing", error);
    }
  }

  function maybeFlush() {
    if (isComplete()) flush();
  }

  return {
    /** Ms since JS start. */
    elapsed,
    /**
     * Arms the report: sends as soon as the launch is complete, or after
     * `maxWaitMs` with what it has. Later calls do nothing.
     */
    begin(
      sender: (event: string, properties: StartupTimingProperties) => void,
      maxWaitMs: number = STARTUP_TIMING_MAX_WAIT_MS,
    ) {
      if (send) return;
      send = sender;
      capTimer = deps.setTimer(() => {
        capTimer = null;
        flush();
      }, Math.max(0, maxWaitMs - elapsed()));
      maybeFlush();
    },
    /** Records a mark the first time it happens; later ones are ignored. */
    mark(name: StartupMark) {
      if (sent || marks[name] !== undefined) return;
      marks[name] = elapsed();
      if (name === "splashHidden") notify();
      maybeFlush();
    },
    /** Sets flags not already set (the first answer is the launch's answer). */
    setFlags(next: StartupFlags) {
      if (sent) return;
      for (const [key, value] of Object.entries(next) as [keyof StartupFlags, StartupFlags[keyof StartupFlags]][]) {
        if (value === undefined || flags[key] !== undefined) continue;
        (flags as Record<string, unknown>)[key] = value;
      }
    },
    /** Like `setFlags`, but replaces a value already set. */
    overrideFlags(next: StartupFlags) {
      if (sent) return;
      Object.assign(flags, next);
    },
    /**
     * The first screen settled. The first call wins; it also marks
     * `firstScreen`, wakes `whenFirstScreen` and tells the splash.
     */
    firstScreen(result: StartupOutcome) {
      if (outcome !== null) return;
      outcome = result;
      if (!sent) marks.firstScreen = elapsed();
      for (const resolve of screenWaiters.splice(0)) resolve();
      notify();
      maybeFlush();
    },
    /** What the first screen was, or null while it is still loading. */
    outcome: () => outcome,
    /** Resolves once the first screen has settled (at once if it has). */
    whenFirstScreen(): Promise<void> {
      if (outcome !== null) return Promise.resolve();
      return new Promise<void>((resolve) => {
        screenWaiters.push(resolve);
      });
    },
    /** Hear `firstScreen` and `splashHidden`. Returns the unsubscribe. */
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hasMark: (name: StartupMark) => marks[name] !== undefined,
    isSent: () => sent,
    /** What would be sent now. For tests and dev logging. */
    properties,
  };
}

/** What the Schedule tab is drawing, in the terms its branches use. */
export type ScheduleScreenState = {
  /** The onboarding tour is up (it covers whatever is under it). */
  onboardingShowing: boolean;
  /** The meets list has not been read yet ("Loading meets..."). */
  meetsLoading: boolean;
  /** The stored meet is being looked up by name; a meet may still arrive. */
  resolvingStoredMeet: boolean;
  /** A meet and its details are selected. */
  hasMeet: boolean;
  /** The schedule's first load is running. */
  scheduleLoading: boolean;
  /** A meet switch is in progress ("Loading schedule..."). */
  changingMeet: boolean;
  /** Days in the schedule shown. */
  scheduleDays: number;
  /** The schedule failed to load and nothing is cached. */
  loadFailed: boolean;
};

/**
 * What the Schedule tab shows, for the startup report and the splash:
 * "pending" while a skeleton is up, "schedule" when the day list renders
 * (which counts once it has laid out), else the settled empty states. Same
 * order as the screen's own branches.
 */
export function scheduleScreenOutcome(state: ScheduleScreenState): StartupOutcome | "pending" {
  if (state.onboardingShowing) return "onboarding";
  if (state.meetsLoading) return "pending";
  if (!state.hasMeet) return state.resolvingStoredMeet ? "pending" : "no-meet";
  if ((state.scheduleLoading && state.scheduleDays === 0) || state.changingMeet) return "pending";
  if (state.scheduleDays > 0) return "schedule";
  return state.loadFailed ? "error" : "empty-schedule";
}

function monotonicNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/** This process's launch. */
export const startupTiming = createStartupTiming({
  now: monotonicNow,
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
});
