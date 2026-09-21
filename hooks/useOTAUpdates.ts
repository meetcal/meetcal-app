import { useEffect, useState, useCallback, useRef } from 'react';
import * as Updates from 'expo-updates';
import { Alert, AppState, Platform } from 'react-native';
import { isNetworkAvailable } from '@/lib/networkUtils';

/**
 * `UpdateNotification` is the only consumer and reads exactly these five
 * values. An `isChecking` flag and a `progress` number were also published:
 * both were written and never read, and `progress` could only ever be 0 or
 * 100 because expo-updates has no download-progress callback to drive it.
 */
export interface OTAUpdateState {
  isDownloading: boolean;
  isUpdateAvailable: boolean;
  error: string | null;
}

export interface OTAUpdateActions {
  downloadAndRestart: () => Promise<void>;
  dismissUpdate: () => void;
}

const FOREGROUND_CHECK_THROTTLE_MS = 5 * 60 * 1000;

export function useOTAUpdates(): OTAUpdateState & OTAUpdateActions {
  const [state, setState] = useState<OTAUpdateState>({
    isDownloading: false,
    isUpdateAvailable: false,
    error: null,
  });

  // The launch check and every foreground check await the network probe and
  // then expo-updates. Without this the resolution lands on an unmounted
  // provider during a sign-out remount.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const resetState = useCallback(() => {
    if (!isMountedRef.current) return;
    setState(prev => ({
      ...prev,
      isDownloading: false,
      error: null,
    }));
  }, []);

  const checkForUpdate = useCallback(async () => {
    // Don't check for updates in development mode
    if (__DEV__) {
      console.log('[OTA] Skipping update check in development mode');
      return;
    }

    // Only check for updates if the app was loaded from a bundle
    if (!Updates.isEnabled) {
      console.log('[OTA] Updates are not enabled');
      return;
    }

    // Check network connectivity before attempting update check
    const hasNetwork = await isNetworkAvailable();
    if (!hasNetwork) {
      console.log('[OTA] Skipping update check - no network available');
      return; // Silently skip, don't show error to user
    }

    try {
      const update = await Updates.checkForUpdateAsync();
      if (!isMountedRef.current) return;

      if (update.isAvailable) {
        console.log('[OTA] Update available');
        setState(prev => ({ ...prev, isUpdateAvailable: true }));
      } else {
        console.log('[OTA] No update available');
        resetState();
      }
    } catch (error) {
      // A background check the user never asked for must not surface anything:
      // `error` renders a blocking full-screen "Update Error" modal with the
      // raw SDK string, and this runs on launch plus every foreground. The
      // no-network branch above already decided this is silent; a captive
      // portal or a 5xx from the update server is the same situation.
      console.error('[OTA] Error checking for updates:', error);
      resetState();
    }
  }, [resetState]);

  const downloadAndRestart = useCallback(async () => {
    if (!state.isUpdateAvailable) return;

    try {
      setState(prev => ({ ...prev, isDownloading: true, error: null }));

      await Updates.fetchUpdateAsync();

      // Show confirmation before restarting
      Alert.alert(
        'Update Downloaded',
        'The app needs to restart to apply the update. Continue?',
        [
          {
            text: 'Later',
            style: 'cancel',
            onPress: () => resetState(),
          },
          {
            text: 'Restart Now',
            onPress: async () => {
              try {
                await Updates.reloadAsync();
              } catch (error) {
                console.error('[OTA] Error restarting app:', error);
                setState(prev => ({ 
                  ...prev, 
                  isDownloading: false,
                  error: 'Failed to restart app'
                }));
              }
            },
          },
        ]
      );
    } catch (error) {
      console.error('[OTA] Error downloading update:', error);
      setState(prev => ({ 
        ...prev, 
        isDownloading: false,
        error: error instanceof Error ? error.message : 'Failed to download update'
      }));
    }
  }, [state.isUpdateAvailable, resetState]);

  const dismissUpdate = useCallback(() => {
    setState(prev => ({ 
      ...prev, 
      isUpdateAvailable: false,
      error: null
    }));
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      checkForUpdate();
    }
  }, [checkForUpdate]);

  const lastForegroundCheckRef = useRef<number>(Date.now());

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState !== 'active') return;
      const now = Date.now();
      if (now - lastForegroundCheckRef.current < FOREGROUND_CHECK_THROTTLE_MS) return;
      lastForegroundCheckRef.current = now;
      checkForUpdate();
    });

    return () => subscription.remove();
  }, [checkForUpdate]);

  return {
    ...state,
    downloadAndRestart,
    dismissUpdate,
  };
}