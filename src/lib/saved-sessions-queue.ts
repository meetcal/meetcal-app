/**
 * A promise queue that runs tasks one at a time, in call order.
 *
 * Saved-session mutations are read-modify-write over one AsyncStorage key:
 * two concurrent `saveSession` calls (the legacy migration used to
 * `Promise.all` one per row) each read the same list, and whichever committed
 * last silently dropped the other's row. Same pattern as the write chain in
 * `lib/authCache.ts`, exposed as a factory so the hook can hold one per mount.
 *
 * Not re-entrant: a task must not await another task on the same queue.
 */
export interface SerialQueue {
  run<T>(task: () => Promise<T>): Promise<T>;
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const next = tail.then(task, task);
      tail = next.catch(() => undefined);
      return next;
    },
  };
}
