/**
 * Orders meet downloads against the clears that remove their data.
 *
 * A full prefetch (a Download, Refresh All, or the automatic refresh of a
 * downloaded meet) can run for minutes: a national meet's history pass is
 * ~38 sequential requests. Remove, Delete All, Clear Cache and the expiry
 * sweep used to clear the meet underneath it and return, while the pass kept
 * writing history for athletes on no stored roster, and a later Download (or
 * Clear Cache's re-sync) joined that old request and marked the meet
 * downloaded with nothing on disk.
 *
 * Now every clear runs through `runMeetClear` / `runHistoryClear`. That
 * stamps the clear, so a prefetch that started before it sees
 * `wasClearedSince` and stops at its next checkpoint (between requests), and
 * then waits for such prefetches to settle, so nothing they were writing
 * lands after the clear. `meet-manager` registers how to wait for them; this
 * module cannot import it (`offline-store` would then depend on the module
 * that depends on it).
 */

/** A point in the clear sequence: compare against it with `wasClearedSince`. */
export type ClearEpoch = number;

let clearCount = 0;
/** Last clear per meet. Bounded by the meets cleared in this process. */
const lastMeetClear = new Map<string, number>();
let lastHistoryClear = 0;

type InFlightSettler = (meet: string | null) => Promise<void>;
let settleInFlight: InFlightSettler | null = null;

/**
 * Clears still running, per meet (`null`: an athlete-history clear). A
 * download that starts meanwhile waits for them (`waitForClears`): started
 * after the stamp, it is not superseded, but it could still read the ETag and
 * roster the clear is about to delete and finish as if nothing happened.
 * Bounded by the clears running at once.
 */
const runningClears = new Map<string | null, Set<Promise<unknown>>>();

function track<T>(key: string | null, run: Promise<T>): Promise<T> {
  const set = runningClears.get(key) ?? new Set<Promise<unknown>>();
  runningClears.set(key, set);
  set.add(run);
  const done = () => {
    set.delete(run);
    if (set.size === 0 && runningClears.get(key) === set) runningClears.delete(key);
  };
  run.then(done, done);
  return run;
}

/** Whether a clear of `meet`, or an athlete-history clear, is running. */
export function isClearRunning(meet: string): boolean {
  return runningClears.has(meet) || runningClears.has(null);
}

/**
 * Resolves once no clear of `meet`, and no athlete-history clear, is running.
 * Never rejects.
 */
export async function waitForClears(meet: string): Promise<void> {
  while (isClearRunning(meet)) {
    const running = [...(runningClears.get(meet) ?? []), ...(runningClears.get(null) ?? [])];
    await Promise.all(running.map((run) => run.catch(() => undefined)));
  }
}

export function captureClearEpoch(): ClearEpoch {
  return clearCount;
}

/** Whether `meet`'s data or all athlete history was cleared after `epoch`. */
export function wasClearedSince(meet: string, epoch: ClearEpoch): boolean {
  return (lastMeetClear.get(meet) ?? 0) > epoch || lastHistoryClear > epoch;
}

/**
 * How a clear waits for the prefetches it superseded. `meet` null means every
 * meet (the athlete-history clear). Must resolve, never reject.
 */
export function registerInFlightPrefetchSettler(settler: InFlightSettler | null): void {
  settleInFlight = settler;
}

/**
 * Runs a clear of `meet`'s data: marks the meet cleared from now on, waits
 * for any prefetch of it that started earlier, then runs `clear`. The wait is
 * outside the meet's write chain (`clear` joins it): the prefetch being waited
 * for may itself be queued on it.
 */
export function runMeetClear<T>(meet: string, clear: () => Promise<T>): Promise<T> {
  clearCount += 1;
  lastMeetClear.set(meet, clearCount);
  return track(
    meet,
    (async () => {
      await settleInFlight?.(meet);
      return clear();
    })(),
  );
}

/** Same as `runMeetClear`, for every meet: athlete history is shared. */
export function runHistoryClear<T>(clear: () => Promise<T>): Promise<T> {
  clearCount += 1;
  lastHistoryClear = clearCount;
  return track(
    null,
    (async () => {
      await settleInFlight?.(null);
      return clear();
    })(),
  );
}

/** Test-only. */
export function resetOfflineClearsForTests(): void {
  clearCount = 0;
  lastMeetClear.clear();
  lastHistoryClear = 0;
  runningClears.clear();
}
