import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { isOfflineModeSimulated } from '@/config/development';

/**
 * NetInfo reports `isInternetReachable: null` while it is still probing, and
 * on a cold start that is the value everything sees first. Treating unknown as
 * offline would make every consumer fall back to its cache on launch, so only
 * an explicit `false` counts as offline. One copy of that rule; it was
 * open-coded at all three read sites.
 */
function isReachable(state: NetInfoState): boolean {
  return state.isInternetReachable !== false;
}

let lastKnownNetwork: boolean | null = null;
let lastCheckedAt = 0;
let inFlightCheck: Promise<boolean> | null = null;
const NETWORK_CACHE_MS = 3000;

NetInfo.addEventListener(state => {
  lastKnownNetwork = isReachable(state);
  lastCheckedAt = Date.now();
});

/**
 * Check if the device currently has network connectivity
 * @returns Promise<boolean> - true if connected, false otherwise
 */
export async function isNetworkAvailable(): Promise<boolean> {
  // Check if we're simulating offline mode in development
  if (isOfflineModeSimulated()) {
    console.log('[DEV] Simulating offline mode');
    return false;
  }

  try {
    const now = Date.now();
    if (lastKnownNetwork !== null && now - lastCheckedAt < NETWORK_CACHE_MS) {
      return lastKnownNetwork;
    }

    if (inFlightCheck) {
      return await inFlightCheck;
    }

    inFlightCheck = NetInfo.fetch()
      .then(state => {
        const isConnectedAndReachable = isReachable(state);
        lastKnownNetwork = isConnectedAndReachable;
        lastCheckedAt = Date.now();
        return isConnectedAndReachable;
      })
      .finally(() => {
        inFlightCheck = null;
      });

    return await inFlightCheck;
  } catch (error) {
    console.error('Error checking network availability:', error);
    if (lastKnownNetwork !== null) {
      return lastKnownNetwork;
    }
    // If we can't check, assume network is available to allow attempts
    return true;
  }
}

/**
 * Subscribe to network state changes
 * @param callback - Function to call when network state changes
 * @returns Unsubscribe function
 */
export function subscribeToNetworkChanges(
  callback: (isConnected: boolean) => void
): () => void {
  // Honour the same dev flag `isNetworkAvailable` does. Without this the five
  // subscribers (useIsOffline, useMutableResource, both providers, the auth
  // layout) were told "online" by the live listener while every
  // `isNetworkAvailable()` in the same session answered false — and a
  // "reconnected" edge fires exactly the refetches the flag exists to stop.
  if (isOfflineModeSimulated()) {
    return () => {};
  }

  return NetInfo.addEventListener(state => {
    callback(isReachable(state));
  });
}
