import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { isReachable } from '@/lib/networkUtils';
import { recycleConnection } from './transport';

/**
 * Back from the background after at least this long, the shared Convex socket
 * is assumed dead (iOS suspends it) and replaced rather than waited on.
 */
export const RESUME_RECYCLE_AFTER_MS = 30_000;

/**
 * Replaces the shared Convex connection (`recycleConnection`) when the old
 * one cannot be trusted: the network came back, the device moved to another
 * network (Wi-Fi to cellular), or the app returned from a long spell in the
 * background. The Convex client would otherwise notice only after a minute of
 * silence, and every read until then would wait out its timeout. Returns the
 * unsubscribe.
 */
export function watchConnectionLifecycle(recycle: () => void = recycleConnection): () => void {
  let lastOnline: boolean | null = null;
  let lastType: string | null = null;
  const unsubscribeNetwork = NetInfo.addEventListener((state) => {
    const online = isReachable(state);
    const cameBack = online && lastOnline === false;
    const switched = online && lastOnline === true && lastType !== null && state.type !== lastType;
    if (cameBack || switched) recycle();
    lastOnline = online;
    lastType = state.type;
  });

  let backgroundedAt: number | null = null;
  const appState = AppState.addEventListener('change', (status) => {
    if (status === 'background') {
      backgroundedAt ??= Date.now();
    } else if (status === 'active') {
      if (backgroundedAt !== null && Date.now() - backgroundedAt >= RESUME_RECYCLE_AFTER_MS) recycle();
      backgroundedAt = null;
    }
  });

  return () => {
    unsubscribeNetwork();
    appState.remove();
  };
}
