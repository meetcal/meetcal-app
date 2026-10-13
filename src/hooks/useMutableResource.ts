import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  MutableResource,
  ResourceCacheEntry,
  ResourceSource,
  reconnectRefetchDelayMs,
} from "@/lib/data/mutable-resource";
import { subscribeToNetworkChanges } from "@/lib/networkUtils";

export type MutableResourceState<T> = {
  data: T;
  /**
   * Set only when there is nothing to show. Consumers (`DataTable`) render
   * `error` *instead of* `data`, so a revalidate that fails on top of a warm
   * cache must not land here — see `refreshError`.
   */
  error: string | null;
  /**
   * Set when a revalidate failed while `data` still holds usable (cached)
   * rows. The rows stay on screen; this is for anything that wants to show a
   * "couldn't refresh" hint next to them.
   */
  refreshError: string | null;
  isInitialLoading: boolean;
  isRefreshing: boolean;
  lastUpdatedAt: number | null;
  source: ResourceSource | null;
  /**
   * Revalidate. Never rejects: resolves `false` when the request failed (the
   * failure is in `error` or `refreshError`), so a pull-to-refresh can say
   * so; `true` otherwise, a request the screen moved on from included.
   */
  refresh: () => Promise<boolean>;
  invalidate: () => Promise<void>;
};

type UseMutableResourceOptions<T, TParams extends readonly unknown[]> = {
  resource: MutableResource<T, TParams>;
  /**
   * `null` when the screen does not yet know what to fetch — no WSO picked, no
   * meet selected, a route param still resolving. The hook stays idle, reports
   * `isInitialLoading: false`, and starts as soon as real params arrive.
   *
   * This used to be non-optional alongside a separate `enabled` flag, so every
   * conditional call site invented a sentinel tuple (`[""] as const as
   * [string]`) purely to satisfy the type and then re-derived the same
   * condition as `enabled: Boolean(params)`. One nullable value says it once.
   */
  params: TParams | null;
  initialData: T;
};

export function useMutableResource<T, TParams extends readonly unknown[]>(
  options: UseMutableResourceOptions<T, TParams>,
): MutableResourceState<T> {
  const { resource, params, initialData } = options;
  const enabled = params !== null;

  const key = useMemo(
    () => (params === null ? null : resource.getKey(...params)),
    [params, resource],
  );
  const paramsRef = useRef(params);
  const sourceRef = useRef<ResourceSource | null>(null);
  const lastReconnectStateRef = useRef<boolean | null>(null);
  const previousKeyRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const initialDataRef = useRef(initialData);
  paramsRef.current = params;
  initialDataRef.current = initialData;

  const [data, setData] = useState<T>(initialData);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(enabled);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [source, setSource] = useState<ResourceSource | null>(null);
  sourceRef.current = source;
  // What is on screen, for a refresh to compare the fresh answer with, and
  // whether it is also what storage holds. After a failed write it is not:
  // comparing with the screen would then skip every later write of the same
  // answer and leave the stored copy stale for good.
  const shownRef = useRef<ResourceCacheEntry<T>>({ data, lastUpdatedAt });
  shownRef.current = { data, lastUpdatedAt };
  const shownIsStoredRef = useRef(true);

  const refresh = useCallback(
    async (
      forceBackground = false,
      preloadedCache?: ResourceCacheEntry<T> | null,
    ): Promise<boolean> => {
      const activeParams = paramsRef.current;
      if (activeParams === null) return true;

      // Data is already on screen when a source has been rendered, or when we
      // are revalidating on top of a cache entry that was just painted.
      const hasDataOnScreen =
        sourceRef.current !== null || preloadedCache != null;
      if (hasDataOnScreen || forceBackground) {
        setIsRefreshing(true);
      } else {
        setIsInitialLoading(true);
      }

      // The params can change under us (the user switches WSO/gender) while
      // this request is in flight. Anything that resolves for a key we are no
      // longer showing must not touch state.
      const requestKey = resource.getKey(...activeParams);
      const isStale = () => {
        if (!mountedRef.current) return true;
        const current = paramsRef.current;
        return current === null || resource.getKey(...current) !== requestKey;
      };

      // Compared with what is on screen when something is: re-reading the
      // stored copy cost a disk read and parse (for the schedule, the whole
      // meet), and handed back a new object even when nothing changed, so
      // every consumer re-rendered on each reconnect and pull-to-refresh.
      const compareWith =
        preloadedCache !== undefined
          ? preloadedCache
          : sourceRef.current !== null && shownIsStoredRef.current
            ? shownRef.current
            : undefined;
      try {
        const result = compareWith === undefined
          ? await resource.revalidate(...activeParams)
          : await resource.revalidateWithCached(compareWith, ...activeParams);
        if (isStale()) return true;
        shownIsStoredRef.current = result.stored !== false;
        setData(result.data);
        setLastUpdatedAt(result.lastUpdatedAt);
        setSource(result.source);
        setError(null);
        setRefreshError(null);
        return true;
      } catch (caughtError) {
        if (isStale()) return true;
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : "An error occurred";
        // A failed revalidate must never blank out rows we are already
        // showing: offline, the cached table is the whole point.
        if (hasDataOnScreen) {
          setRefreshError(message);
        } else {
          setError(message);
        }
        return false;
      } finally {
        if (!isStale()) {
          setIsRefreshing(false);
          setIsInitialLoading(false);
        }
      }
    },
    [resource],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const invalidate = useCallback(async () => {
    const activeParams = paramsRef.current;
    if (activeParams === null) return;
    const requestKey = resource.getKey(...activeParams);
    await resource.invalidate(...activeParams);
    const currentParams = paramsRef.current;
    if (
      !mountedRef.current ||
      currentParams === null ||
      resource.getKey(...currentParams) !== requestKey
    ) return;
    setData(initialDataRef.current);
    setError(null);
    setRefreshError(null);
    setLastUpdatedAt(null);
    setSource(null);
    setIsInitialLoading(true);
    setIsRefreshing(false);
  }, [resource]);

  const refreshResource = useCallback(
    () => refresh(sourceRef.current !== null),
    [refresh],
  );

  const invalidateResource = useCallback(() => invalidate(), [invalidate]);

  useEffect(() => {
    let cancelled = false;

    async function loadResource() {
      const activeParams = paramsRef.current;
      if (activeParams === null) {
        previousKeyRef.current = null;
        sourceRef.current = null;
        setData(initialDataRef.current);
        setError(null);
        setRefreshError(null);
        setLastUpdatedAt(null);
        setSource(null);
        setIsInitialLoading(false);
        setIsRefreshing(false);
        return;
      }

      const keyChanged = previousKeyRef.current !== key;
      previousKeyRef.current = key;

      setError(null);
      setRefreshError(null);
      setIsRefreshing(false);
      if (keyChanged) {
        sourceRef.current = null;
        setData(initialDataRef.current);
        setLastUpdatedAt(null);
        setSource(null);
      }

      if (keyChanged || sourceRef.current === null) {
        setIsInitialLoading(true);
      }

      const cached = await resource.loadCached(...activeParams);
      if (cancelled) return;

      if (cached) {
        shownIsStoredRef.current = true;
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
  }, [enabled, key, refresh, resource]);

  useEffect(() => {
    if (!enabled) return;

    // Jitter reconnect refetches so a venue-wide connectivity flap does not
    // hit the API with every subscriber at the same instant.
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeToNetworkChanges((isConnected) => {
      const previous = lastReconnectStateRef.current;
      lastReconnectStateRef.current = isConnected;
      if (isConnected && previous === false && reconnectTimer === null) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          refresh(true).catch((refreshError) => {
            console.error("Failed to revalidate resource after reconnect", {
              key,
              error: refreshError,
            });
          });
        }, reconnectRefetchDelayMs());
      }
    });

    return () => {
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      unsubscribe();
    };
  }, [enabled, key, refresh]);

  return {
    data,
    error,
    refreshError,
    isInitialLoading,
    isRefreshing,
    lastUpdatedAt,
    source,
    refresh: refreshResource,
    invalidate: invalidateResource,
  };
}
