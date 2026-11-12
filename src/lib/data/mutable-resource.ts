import { isRecord } from '@/lib/is-record';
export type ResourceSource = "cache" | "network";

export type ResourceCacheEntry<T> = {
  data: T;
  lastUpdatedAt: number | null;
  tag?: string | null;
};

export type TaggedFresh<T> = { status: "unchanged" } | { status: "fresh"; data: T; tag: string | null };

export type TaggedResourceSource<T, TParams extends readonly unknown[]> = {
  fetch: (knownTag: string | null, ...params: TParams) => Promise<TaggedFresh<T>>;
  persist: (
    data: T,
    tag: string | null,
    ...params: TParams
  ) => Promise<ResourceCacheEntry<T> | null | void>;
};

export type MutableResourceConfig<T, TParams extends readonly unknown[]> = {
  getKey: (...params: TParams) => string;
  loadCached: (...params: TParams) => Promise<ResourceCacheEntry<T> | null>;
  fetchFresh: (...params: TParams) => Promise<T>;
  persistFresh: (
    data: T,
    ...params: TParams
  ) => Promise<ResourceCacheEntry<T> | null | void>;
  isEqual?: (left: T, right: T) => boolean;
  /**
   * Whether a fresh answer is handed to every subscriber of its key (see
   * `subscribe`). Default: always. The schedule says no for an empty one, so
   * a background refresh that catches a schedule briefly unpublished does
   * not blank every screen showing it; the caller that asked still gets it.
   */
  isPublishable?: (data: T) => boolean;
  /**
   * True when a fresh answer must not replace the cached data (for a roster,
   * an empty answer over cached athletes). The cached data is then the
   * result, and the fresh answer is neither persisted nor shown. Only asked
   * when there is a cache entry.
   */
  keepCached?: (cached: T, fresh: T) => boolean;
  tagged?: TaggedResourceSource<T, TParams>;
};

export type ResourceRevalidation<T> = {
  data: T;
  changed: boolean;
  lastUpdatedAt: number | null;
  source: "network";
  /** False when the answer changed and could not be stored. */
  stored?: boolean;
  tag?: string | null;
};

export type MutableResource<T, TParams extends readonly unknown[]> = {
  getKey: (...params: TParams) => string;
  loadCached: (...params: TParams) => Promise<ResourceCacheEntry<T> | null>;
  revalidate: (...params: TParams) => Promise<ResourceRevalidation<T>>;
  revalidateWithCached(
    cached: ResourceCacheEntry<T> | null,
    ...params: TParams
  ): Promise<ResourceRevalidation<T>>;
  /**
   * Hear every successful revalidate of `key`, whoever started it (a screen,
   * a pull to refresh, the background `SyncManager`), so every mounted copy
   * of the data moves together. Returns the unsubscribe.
   */
  subscribe: (key: string, listener: (result: ResourceRevalidation<T>) => void) => () => void;
  /**
   * The resource's own equality, for a subscriber to skip an unchanged
   * answer. Method syntax on purpose: it keeps the type usable where a hook
   * widens `T` (a `MutableResource<Stats>` read as `Stats | null`).
   */
  isEqual(left: T, right: T): boolean;
};

/**
 * Upper bound of the random delay a reconnect-triggered refetch waits before
 * hitting the API. Every mounted resource sees the same "back online" edge at
 * the same instant, and the backend's request ceiling is 15 s, so a burst of
 * simultaneous refetches from every screen is exactly what times out.
 */
export const RECONNECT_REFETCH_JITTER_MAX_MS = 1500;

/** A delay in `[0, RECONNECT_REFETCH_JITTER_MAX_MS)` for one reconnect refetch. */
export function reconnectRefetchDelayMs(random: () => number = Math.random): number {
  const value = Math.floor(random() * RECONNECT_REFETCH_JITTER_MAX_MS);
  return Math.min(Math.max(value, 0), RECONNECT_REFETCH_JITTER_MAX_MS - 1);
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }

  if (isRecord(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortObjectKeys(value[key]);
    return sorted;
  }

  return value;
}

export function stableSerialize(value: unknown): string {
  return JSON.stringify(sortObjectKeys(value));
}

function definedKeyCount(record: Record<string, unknown>): number {
  let count = 0;
  for (const key of Object.keys(record)) if (record[key] !== undefined) count += 1;
  return count;
}

export function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!jsonEqual(left[index] ?? null, right[index] ?? null)) return false;
    }
    return true;
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  for (const key of Object.keys(left)) {
    const value = left[key];
    if (value === undefined) continue;
    if (!Object.prototype.hasOwnProperty.call(right, key) || !jsonEqual(value, right[key])) return false;
  }
  return definedKeyCount(left) === definedKeyCount(right);
}

export function defaultIsEqual<T>(left: T, right: T): boolean {
  return jsonEqual(left, right);
}

export function createMutableResource<T, TParams extends readonly unknown[]>(
  config: MutableResourceConfig<T, TParams>,
): MutableResource<T, TParams> {
  const isEqual = config.isEqual ?? defaultIsEqual<T>;
  const inFlightRequests = new Map<string, Promise<ResourceRevalidation<T>>>();
  const listeners = new Map<string, Set<(result: ResourceRevalidation<T>) => void>>();
  const publish = (key: string, result: ResourceRevalidation<T>) => {
    if (config.isPublishable && !config.isPublishable(result.data)) return;
    for (const listener of [...(listeners.get(key) ?? [])]) {
      try {
        listener(result);
      } catch (listenerError) {
        console.error("Resource subscriber failed", { key, error: listenerError });
      }
    }
  };
  const revalidateWithCached = async (
    cached: ResourceCacheEntry<T> | null | undefined,
    ...params: TParams
  ) => {
    const key = config.getKey(...params);
    const existingRequest = inFlightRequests.get(key);
    if (existingRequest) return existingRequest;

    const request = (async (): Promise<ResourceRevalidation<T>> => {
      const cacheEntry = cached === undefined
        ? await config.loadCached(...params)
        : cached;
      const knownTag = cacheEntry?.tag ?? null;
      let fresh: T;
      let tag: string | null | undefined;
      if (config.tagged) {
        const answer = await config.tagged.fetch(cacheEntry ? knownTag : null, ...params);
        if (answer.status === "unchanged") {
          if (!cacheEntry) throw new Error(`${key} answered unchanged with nothing cached`);
          const result: ResourceRevalidation<T> = {
            data: cacheEntry.data,
            changed: false,
            lastUpdatedAt: cacheEntry.lastUpdatedAt ?? Date.now(),
            source: "network",
            tag: knownTag,
          };
          publish(key, result);
          return result;
        }
        fresh = answer.data;
        tag = answer.tag;
      } else {
        fresh = await config.fetchFresh(...params);
      }
      if (cacheEntry && config.keepCached?.(cacheEntry.data, fresh)) {
        return {
          data: cacheEntry.data,
          changed: false,
          lastUpdatedAt: cacheEntry.lastUpdatedAt ?? Date.now(),
          source: "network" as const,
          ...(config.tagged ? { tag: knownTag } : {}),
        };
      }
      const sameVersion = tag != null && tag === knownTag;
      const changed = !cacheEntry || (!sameVersion && !isEqual(cacheEntry.data, fresh));
      const retag = config.tagged !== undefined && !changed && tag !== undefined && tag !== knownTag;
      let persisted: ResourceCacheEntry<T> | null | void = null;
      let stored = true;
      if (changed || retag) {
        try {
          persisted = config.tagged
            ? await config.tagged.persist(fresh, tag ?? null, ...params)
            : await config.persistFresh(fresh, ...params);
        } catch (persistError) {
          stored = !changed;
          console.warn("Failed to persist fresh resource data; serving it uncached", {
            key,
            error: persistError,
          });
        }
      }

      const result: ResourceRevalidation<T> = {
        data: changed ? fresh : cacheEntry.data,
        changed,
        lastUpdatedAt:
          persisted?.lastUpdatedAt ?? cacheEntry?.lastUpdatedAt ?? Date.now(),
        source: "network",
        stored,
        ...(config.tagged ? { tag: tag === undefined ? knownTag : tag } : {}),
      };
      publish(key, result);
      return result;
    })().finally(() => inFlightRequests.delete(key));

    inFlightRequests.set(key, request);
    return request;
  };

  return {
    getKey: (...params) => config.getKey(...params),
    loadCached: (...params) => config.loadCached(...params),
    revalidate: async (...params) => revalidateWithCached(undefined, ...params),
    revalidateWithCached: async (cached, ...params) =>
      revalidateWithCached(cached, ...params),
    subscribe: (key, listener) => {
      let keyListeners = listeners.get(key);
      if (!keyListeners) {
        keyListeners = new Set();
        listeners.set(key, keyListeners);
      }
      keyListeners.add(listener);
      return () => {
        const current = listeners.get(key);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) listeners.delete(key);
      };
    },
    isEqual,
  };
}
