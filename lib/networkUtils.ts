import NetInfo from '@react-native-community/netinfo';
import { isOfflineModeSimulated } from '@/config/development';

let lastKnownNetwork: boolean | null = null;
let lastCheckedAt = 0;
let inFlightCheck: Promise<boolean> | null = null;
const NETWORK_CACHE_MS = 3000;

NetInfo.addEventListener(state => {
  const isConnected = state.isConnected === true;
  const isReachable = state.isInternetReachable;
  lastKnownNetwork = isReachable === false ? false : isConnected;
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
        const isConnected = state.isConnected === true;
        const isReachable = state.isInternetReachable;
        const isConnectedAndReachable = isReachable === false ? false : isConnected;
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
  const unsubscribe = NetInfo.addEventListener(state => {
    const isConnected = state.isConnected === true && state.isInternetReachable !== false;
    callback(isConnected);
  });

  return unsubscribe;
}
