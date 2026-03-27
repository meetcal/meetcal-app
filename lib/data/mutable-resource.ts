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

  return {
    getKey: (...params) => config.getKey(...params),
    loadCached: (...params) => config.loadCached(...params),
    revalidate: async (...params) => {
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

      const request = (async () => {
        const cached = await config.loadCached(...params);
        const fresh = await config.fetchFresh(...params);
        const changed = !cached || !isEqual(cached.data, fresh);
        const persisted = changed
          ? await config.persistFresh(fresh, ...params)
          : null;

        return {
          data: changed ? fresh : cached.data,
          changed,
          lastUpdatedAt:
            persisted?.lastUpdatedAt ?? cached?.lastUpdatedAt ?? Date.now(),
          source: "network" as const,
        };
      })().finally(() => {
        inFlightRequests.delete(key);
      });

      inFlightRequests.set(key, request);
      return request;
    },
    invalidate: async (...params) => {
      const key = config.getKey(...params);
      inFlightRequests.delete(key);
      if (config.clearCached) {
        await config.clearCached(...params);
      }
    },
  };
}
