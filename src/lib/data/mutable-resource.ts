export type ResourceSource = "cache" | "network";

export type ResourceCacheEntry<T> = {
  data: T;
  lastUpdatedAt: number | null;
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
};

export type ResourceRevalidation<T> = {
  data: T;
  changed: boolean;
  lastUpdatedAt: number | null;
  source: "network";
  /** False when the answer changed and could not be stored. */
  stored?: boolean;
};

export type MutableResource<T, TParams extends readonly unknown[]> = {
  getKey: (...params: TParams) => string;
  loadCached: (...params: TParams) => Promise<ResourceCacheEntry<T> | null>;
  revalidate: (
    ...params: TParams
  ) => Promise<{
    data: T;
    changed: boolean;
    lastUpdatedAt: number | null;
    source: "network";
    /** False when the answer changed and could not be stored. */
    stored?: boolean;
  }>;
  revalidateWithCached: (
    cached: ResourceCacheEntry<unknown> | null,
    ...params: TParams
  ) => Promise<{
    data: T;
    changed: boolean;
    lastUpdatedAt: number | null;
    source: "network";
    /** False when the answer changed and could not be stored. */
    stored?: boolean;
  }>;
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

const inFlightRequests = new Map<string, Promise<unknown>>();

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

  if (value && typeof value === "object") {
    const sortedEntries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, sortObjectKeys(nestedValue)]);
    return Object.fromEntries(sortedEntries);
  }

  return value;
}

export function stableSerialize(value: unknown): string {
  return JSON.stringify(sortObjectKeys(value));
}

export function defaultIsEqual<T>(left: T, right: T): boolean {
  return stableSerialize(left) === stableSerialize(right);
}

export function createMutableResource<T, TParams extends readonly unknown[]>(
  config: MutableResourceConfig<T, TParams>,
): MutableResource<T, TParams> {
  const isEqual = config.isEqual ?? defaultIsEqual<T>;
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
    if (existingRequest) {
      return existingRequest as Promise<{
        data: T;
        changed: boolean;
        lastUpdatedAt: number | null;
        source: "network";
        stored?: boolean;
      }>;
    }

    const request = (async (): Promise<ResourceRevalidation<T>> => {
      const cacheEntry = cached === undefined
        ? await config.loadCached(...params)
        : cached;
      const fresh = await config.fetchFresh(...params);
      if (cacheEntry && config.keepCached?.(cacheEntry.data, fresh)) {
        return {
          data: cacheEntry.data,
          changed: false,
          lastUpdatedAt: cacheEntry.lastUpdatedAt ?? Date.now(),
          source: "network" as const,
        };
      }
      const changed = !cacheEntry || !isEqual(cacheEntry.data, fresh);
      // The fresh data is the result; the cache write is a side effect. A
      // failed write (storage full, a validator rejecting one row) used to
      // reject the whole refresh, so the screen kept showing the stale copy —
      // or "nothing yet" — of data that had already arrived.
      let persisted: ResourceCacheEntry<T> | null | void = null;
      let stored = true;
      if (changed) {
        try {
          persisted = await config.persistFresh(fresh, ...params);
        } catch (persistError) {
          stored = false;
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
      revalidateWithCached(cached as ResourceCacheEntry<T> | null, ...params),
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
