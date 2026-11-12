export const SCREEN_TIMING_EVENT = 'screen_timing';
export const SCREEN_TIMING_SAMPLE_RATE = 0.1;

export type ScreenTimingProperties = Record<string, string | number | boolean | null>;
export type ScreenTimingSender = (event: string, properties: ScreenTimingProperties) => void;

export type ScreenVisitDeps = {
  now: () => number;
  random: () => number;
  requestsStarted: () => number;
  sampleRate?: number;
  send: ScreenTimingSender | null;
};

export type ScreenVisit = {
  content: (source: 'cache' | 'network') => void;
  data: () => void;
  failed: () => void;
  finish: () => void;
};

const IDLE_VISIT: ScreenVisit = {
  content: () => undefined,
  data: () => undefined,
  failed: () => undefined,
  finish: () => undefined,
};

export function startScreenVisit(screen: string, deps: ScreenVisitDeps): ScreenVisit {
  const send = deps.send;
  if (!send || deps.random() >= (deps.sampleRate ?? SCREEN_TIMING_SAMPLE_RATE)) return IDLE_VISIT;
  const startedAt = deps.now();
  const requestsAtStart = deps.requestsStarted();
  let firstContentMs: number | null = null;
  let cacheHit: boolean | null = null;
  let dataMs: number | null = null;
  let roundTrips: number | null = null;
  let failed = false;
  let sent = false;
  const elapsed = () => Math.max(0, Math.round(deps.now() - startedAt));

  const emit = (complete: boolean) => {
    if (sent) return;
    sent = true;
    try {
      send(SCREEN_TIMING_EVENT, {
        screen,
        time_to_first_content_ms: firstContentMs,
        time_to_data_ms: dataMs,
        round_trips: roundTrips ?? Math.max(0, deps.requestsStarted() - requestsAtStart),
        cache_hit: cacheHit,
        failed,
        complete,
      });
    } catch (error) {
      console.warn('[perf] failed to send screen timing', error);
    }
  };

  return {
    content: (source) => {
      if (firstContentMs !== null) return;
      firstContentMs = elapsed();
      cacheHit = source === 'cache';
    },
    data: () => {
      if (dataMs !== null) return;
      if (firstContentMs === null) {
        firstContentMs = elapsed();
        cacheHit = false;
      }
      dataMs = elapsed();
      roundTrips = Math.max(0, deps.requestsStarted() - requestsAtStart);
      emit(true);
    },
    failed: () => {
      failed = true;
      emit(true);
    },
    finish: () => emit(false),
  };
}

let sender: ScreenTimingSender | null = null;

export function setScreenTimingSender(next: ScreenTimingSender | null): void {
  sender = next;
}

export function screenTimingSender(): ScreenTimingSender | null {
  return sender;
}
