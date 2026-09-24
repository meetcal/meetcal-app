import { useEffect, useRef, type MutableRefObject } from 'react';
import { reconnectRefetchDelayMs } from '@/lib/data/mutable-resource';
import { subscribeToNetworkChanges } from '@/lib/networkUtils';

/**
 * Send queued writes when the device comes back online: only on a real
 * offline → online edge (NetInfo also reports the current state on
 * subscribe, and on every Wi-Fi/cellular change), only when something is
 * queued, and after a small jitter so a venue-wide flap does not arrive at
 * the API all at once. Only while a Clerk user is signed in.
 *
 * `replay` is read through a ref, so a new identity does not resubscribe.
 */
export function useReconnectReplay(
  clerkUserId: string | undefined,
  pendingWriteCountRef: MutableRefObject<number>,
  replay: () => Promise<unknown>,
): void {
  const replayRef = useRef(replay);
  replayRef.current = replay;
  useEffect(() => {
    if (!clerkUserId) return;
    let lastConnected: boolean | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeToNetworkChanges((isConnected) => {
      const previous = lastConnected;
      lastConnected = isConnected;
      if (!isConnected || previous !== false || timer !== null) return;
      if (pendingWriteCountRef.current === 0) return;
      timer = setTimeout(() => {
        timer = null;
        void replayRef.current();
      }, reconnectRefetchDelayMs());
    });
    return () => {
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
    };
  }, [clerkUserId, pendingWriteCountRef]);
}
