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
  clearCached?: (...params: TParams) => Promise<void>;
  isEqual?: (left: T, right: T) => boolean;
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
  }>;
  revalidateWithCached: (
    cached: ResourceCacheEntry<unknown> | null,
    ...params: TParams
  ) => Promise<{
    data: T;
    changed: boolean;
    lastUpdatedAt: number | null;
    source: "network";
  }>;
  invalidate: (...params: TParams) => Promise<void>;
};

const inFlightRequests = new Map<string, Promise<unknown>>();

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
      }>;
    }

    // `inFlightRequests` is keyed by resource key, and `invalidate` drops the
    // entry while the request is still running. A plain `delete(key)` in the
    // settle handler therefore deletes whatever is registered *now*, which
    // after an invalidate + restart is the newer request — leaving the map
    // empty while a request is live, so the next caller issues a duplicate
    // fetch instead of joining. Only the owner clears its own entry.
    let request: Promise<{
      data: T;
      changed: boolean;
      lastUpdatedAt: number | null;
      source: "network";
    }>;
    const releaseKey = () => {
      if (inFlightRequests.get(key) === request) {
        inFlightRequests.delete(key);
      }
    };

    request = (async () => {
      const cacheEntry = cached === undefined
        ? await config.loadCached(...params)
        : cached;
      const fresh = await config.fetchFresh(...params);
      const changed = !cacheEntry || !isEqual(cacheEntry.data, fresh);
      const persisted = changed
        ? await config.persistFresh(fresh, ...params)
        : null;

      return {
        data: changed ? fresh : cacheEntry.data,
        changed,
        lastUpdatedAt:
          persisted?.lastUpdatedAt ?? cacheEntry?.lastUpdatedAt ?? Date.now(),
        source: "network" as const,
      };
    })().finally(releaseKey);

    inFlightRequests.set(key, request);
    return request;
  };

  return {
    getKey: (...params) => config.getKey(...params),
    loadCached: (...params) => config.loadCached(...params),
    revalidate: async (...params) => revalidateWithCached(undefined, ...params),
    revalidateWithCached: async (cached, ...params) =>
      revalidateWithCached(cached as ResourceCacheEntry<T> | null, ...params),
    invalidate: async (...params) => {
      const key = config.getKey(...params);
      inFlightRequests.delete(key);
      if (config.clearCached) {
        await config.clearCached(...params);
      }
    },
  };
}
