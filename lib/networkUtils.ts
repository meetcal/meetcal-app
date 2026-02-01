import NetInfo from '@react-native-community/netinfo';
import { isOfflineModeSimulated } from '@/config/development';

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
    const state = await NetInfo.fetch();
    return state.isConnected === true && state.isInternetReachable !== false;
  } catch (error) {
    console.error('Error checking network availability:', error);
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
