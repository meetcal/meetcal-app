/**
 * Runs read-modify-write tasks against one storage value strictly one after
 * another.
 *
 * Several AsyncStorage values are whole-object blobs that many callers update
 * by reading the blob, changing one entry and writing the whole thing back.
 * Two of those overlapping each read the same old copy, and the second write
 * silently dropped the first one's change. Every writer of such a blob goes
 * through one chain, so each task reads what the previous one wrote. Same
 * pattern as the explicit-downloads chain in `offline-store` and
 * `lib/authCache.ts`'s `writeChain`.
 *
 * A failed task rejects its own caller only: the chain moves on to the next
 * task rather than staying broken for the rest of the session.
 */
export type WriteChain = <T>(task: () => Promise<T>) => Promise<T>;

export function createWriteChain(): WriteChain {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.catch(() => undefined).then(task);
    tail = run;
    return run;
  };
}

/**
 * One `WriteChain` per key, for values that are many separate keys rather
 * than one blob: a meet's schedule, roster, results and session caches are
 * written and cleared under the meet id. Tasks for the same key run one after
 * another; different keys do not wait for each other. A key's entry is
 * dropped once its last task settles, so the map holds only keys with work
 * queued.
 */
export type KeyedWriteChain = <T>(key: string, task: () => Promise<T>) => Promise<T>;

export function createKeyedWriteChain(): KeyedWriteChain {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    tails.set(key, run);
    const settle = () => {
      if (tails.get(key) === run) tails.delete(key);
    };
    run.then(settle, settle);
    return run;
  };
}
