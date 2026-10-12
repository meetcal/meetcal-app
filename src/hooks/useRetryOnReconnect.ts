import { useEffect, useRef } from "react";

import { reconnectRefetchDelayMs } from "@/lib/data/mutable-resource";
import { subscribeToNetworkChanges } from "@/lib/networkUtils";

/**
 * Calls `retry` once when the connection comes back (an offline -> online
 * edge) while `active`, after the same random jitter `useMutableResource`
 * uses so every screen does not refetch at the same instant.
 *
 * For screens that load by hand instead of through `useMutableResource`,
 * which gets this for free: the Start List used to stay on its empty state
 * after a failed offline load until the user pulled to refresh.
 */
export function useRetryOnReconnect(active: boolean, retry: () => void): void {
  const retryRef = useRef(retry);
  retryRef.current = retry;

  useEffect(() => {
    if (!active) return;
    let wasConnected: boolean | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeToNetworkChanges((isConnected) => {
      const previous = wasConnected;
      wasConnected = isConnected;
      if (!isConnected || previous !== false || timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        retryRef.current();
      }, reconnectRefetchDelayMs());
    });
    return () => {
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
    };
  }, [active]);
}
