export const REQUEST_INACTIVITY_TIMEOUT_MS = 10_000;
export const READ_MAX_ATTEMPTS = 3;
export const READ_RETRY_BASE_DELAY_MS = 1_000;
export const READ_RETRY_MAX_DELAY_MS = 4_000;
export const WAITING_FOR_CONNECTION_AFTER_MS = 3_000;

const RETRYABLE_HTTP_STATUSES: ReadonlySet<number> = new Set([408, 429, 502, 503, 504]);

export type InactivityTimer = {
  touch: () => void;
  stop: () => void;
};

export function startInactivityTimer(limitMs: number, onSilence: () => void): InactivityTimer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const arm = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (stopped) return;
      stopped = true;
      onSilence();
    }, limitMs);
  };
  arm();
  return {
    touch: () => {
      if (!stopped) arm();
    },
    stop: () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

export function readRetryDelayMs(failedAttempt: number, random: () => number = Math.random): number {
  const exponential = READ_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, failedAttempt - 1);
  const capped = Math.min(exponential, READ_RETRY_MAX_DELAY_MS);
  const jittered = capped / 2 + random() * (capped / 2);
  return Math.min(Math.max(Math.round(jittered), 0), READ_RETRY_MAX_DELAY_MS);
}

export type ReadFailureFacts = {
  status: number | null;
  timedOut: boolean;
};

export function isRetryableReadFailure({ status, timedOut }: ReadFailureFacts): boolean {
  if (timedOut) return true;
  if (status === null) return true;
  return RETRYABLE_HTTP_STATUSES.has(status);
}

export type ReadRetryOptions = {
  maxAttempts?: number;
  classify: (error: unknown) => ReadFailureFacts;
  isOnline: () => Promise<boolean>;
  wait?: (ms: number) => Promise<void>;
  random?: () => number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withReadRetries<T>(run: () => Promise<T>, options: ReadRetryOptions): Promise<T> {
  const maxAttempts = options.maxAttempts ?? READ_MAX_ATTEMPTS;
  const wait = options.wait ?? sleep;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableReadFailure(options.classify(error))) throw error;
      if (!(await options.isOnline().catch(() => true))) throw error;
      await wait(readRetryDelayMs(attempt, options.random));
      if (!(await options.isOnline().catch(() => true))) throw error;
    }
  }
}
