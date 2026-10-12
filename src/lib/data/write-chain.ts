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
