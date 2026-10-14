import { useEffect, useRef, type MutableRefObject } from 'react';
import { reconnectRefetchDelayMs } from '@/lib/data/mutable-resource';
import { subscribeToNetworkChanges } from '@/lib/networkUtils';

/**
 * Bring the saved list up to date when the device comes back online: only
 * on a real offline → online edge (NetInfo also reports the current state on
 * subscribe, and on every Wi-Fi/cellular change), after a small jitter so a
 * venue-wide flap does not arrive at the API all at once, and only while a
 * Clerk user is signed in. `onReconnect(true)` when writes are queued (the
 * caller sends them and reloads), `onReconnect(false)` otherwise (the caller
 * may throttle a refresh that only fetches other devices' changes).
 *
 * `onReconnect` is read through a ref, so a new identity does not resubscribe.
 */
export function useReconnectReplay(
  clerkUserId: string | undefined,
  pendingWriteCountRef: MutableRefObject<number>,
  onReconnect: (hasPendingWrites: boolean) => Promise<unknown>,
): void {
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;
  useEffect(() => {
    if (!clerkUserId) return;
    let lastConnected: boolean | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeToNetworkChanges((isConnected) => {
      const previous = lastConnected;
      lastConnected = isConnected;
      if (!isConnected || previous !== false || timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        void onReconnectRef.current(pendingWriteCountRef.current > 0).catch((error: unknown) => {
          console.error('Saved sessions: reconnect refresh failed', error);
        });
      }, reconnectRefetchDelayMs());
    });
    return () => {
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
    };
  }, [clerkUserId, pendingWriteCountRef]);
}
