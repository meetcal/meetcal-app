import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  MutableResource,
  ResourceCacheEntry,
  ResourceSource,
} from "@/lib/data/mutable-resource";
import { subscribeToNetworkChanges } from "@/lib/networkUtils";

export type MutableResourceState<T> = {
  data: T;
  error: string | null;
  isInitialLoading: boolean;
  isRefreshing: boolean;
  lastUpdatedAt: number | null;
  source: ResourceSource | null;
  refresh: () => Promise<void>;
  invalidate: () => Promise<void>;
};

type UseMutableResourceOptions<T, TParams extends readonly unknown[]> = {
  resource: MutableResource<T, TParams>;
  params: TParams;
  initialData: T;
  enabled?: boolean;
  revalidateOnReconnect?: boolean;
};

export function useMutableResource<T, TParams extends readonly unknown[]>(
  options: UseMutableResourceOptions<T, TParams>,
): MutableResourceState<T> {
  const {
    resource,
    params,
    initialData,
    enabled = true,
    revalidateOnReconnect = true,
  } = options;

  const key = useMemo(
    () => resource.getKey(...params),
    [params, resource],
  );
  const paramsRef = useRef(params);
  const sourceRef = useRef<ResourceSource | null>(null);
  const lastReconnectStateRef = useRef<boolean | null>(null);
  const previousKeyRef = useRef<string | null>(null);
  paramsRef.current = params;

  const [data, setData] = useState<T>(initialData);
  const [error, setError] = useState<string | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(enabled);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [source, setSource] = useState<ResourceSource | null>(null);
  sourceRef.current = source;

  const refresh = useCallback(
    async (
      forceBackground = false,
      preloadedCache?: ResourceCacheEntry<T> | null,
    ) => {
      if (!enabled) return;

      const hasData = sourceRef.current !== null || forceBackground;
      if (hasData) {
        setIsRefreshing(true);
      } else {
        setIsInitialLoading(true);
      }

      try {
        const result = preloadedCache === undefined
          ? await resource.revalidate(...paramsRef.current)
          : await resource.revalidateWithCached(
              preloadedCache,
              ...paramsRef.current,
            );
        setData(result.data);
        setLastUpdatedAt(result.lastUpdatedAt);
        setSource(result.source);
        setError(null);
      } catch (refreshError) {
        setError(
          refreshError instanceof Error
            ? refreshError.message
            : "An error occurred",
        );
      } finally {
        setIsRefreshing(false);
        setIsInitialLoading(false);
      }
    },
    [enabled, resource],
  );

  const invalidate = useCallback(async () => {
    await resource.invalidate(...paramsRef.current);
    setData(initialData);
    setError(null);
    setLastUpdatedAt(null);
    setSource(null);
    setIsInitialLoading(enabled);
    setIsRefreshing(false);
  }, [enabled, initialData, resource]);

  const refreshResource = useCallback(
    () => refresh(sourceRef.current !== null),
    [refresh],
  );

  const invalidateResource = useCallback(() => invalidate(), [invalidate]);

  useEffect(() => {
    let cancelled = false;

    async function loadResource() {
      if (!enabled) {
        setIsInitialLoading(false);
        setIsRefreshing(false);
        return;
      }

      const keyChanged = previousKeyRef.current !== key;
      previousKeyRef.current = key;

      setError(null);
      setIsRefreshing(false);
      if (keyChanged) {
        setData(initialData);
        setLastUpdatedAt(null);
        setSource(null);
      }

      if (keyChanged || sourceRef.current === null) {
        setIsInitialLoading(true);
      }

      const cached = await resource.loadCached(...paramsRef.current);
      if (cancelled) return;

      if (cached) {
        setData(cached.data);
        setLastUpdatedAt(cached.lastUpdatedAt);
        setSource("cache");
        setIsInitialLoading(false);
        void refresh(true, cached);
        return;
      }

      await refresh(false, null);
    }

    loadResource().catch((loadError) => {
      if (cancelled) return;
      setError(
        loadError instanceof Error ? loadError.message : "An error occurred",
      );
      setIsInitialLoading(false);
      setIsRefreshing(false);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, initialData, key, refresh, resource]);

  useEffect(() => {
    if (!enabled || !revalidateOnReconnect) return;

    const unsubscribe = subscribeToNetworkChanges((isConnected) => {
      const previous = lastReconnectStateRef.current;
      lastReconnectStateRef.current = isConnected;
      if (isConnected && previous === false) {
        refresh(true).catch((refreshError) => {
          console.error("Failed to revalidate resource after reconnect", {
            key,
            error: refreshError,
          });
        });
      }
    });

    return unsubscribe;
  }, [enabled, key, refresh, revalidateOnReconnect]);

  return {
    data,
    error,
    isInitialLoading,
    isRefreshing,
    lastUpdatedAt,
    source,
    refresh: refreshResource,
    invalidate: invalidateResource,
  };
}
