import { useEffect, useState, useCallback, useRef } from 'react';
import * as Updates from 'expo-updates';
import { Alert, AppState, Platform } from 'react-native';

export interface OTAUpdateState {
  isChecking: boolean;
  isDownloading: boolean;
  isUpdateAvailable: boolean;
  error: string | null;
  progress: number;
}

export interface OTAUpdateActions {
  checkForUpdate: () => Promise<void>;
  downloadAndRestart: () => Promise<void>;
  dismissUpdate: () => void;
}

const FOREGROUND_CHECK_THROTTLE_MS = 5 * 60 * 1000;

export function useOTAUpdates(): OTAUpdateState & OTAUpdateActions {
  const [state, setState] = useState<OTAUpdateState>({
    isChecking: false,
    isDownloading: false,
    isUpdateAvailable: false,
    error: null,
    progress: 0,
  });

  const resetState = useCallback(() => {
    setState(prev => ({
      ...prev,
      isChecking: false,
      isDownloading: false,
      error: null,
      progress: 0,
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

    try {
      setState(prev => ({ ...prev, isChecking: true, error: null }));
      
      const update = await Updates.checkForUpdateAsync();
      
      if (update.isAvailable) {
        console.log('[OTA] Update available');
        setState(prev => ({ 
          ...prev, 
          isChecking: false, 
          isUpdateAvailable: true 
        }));
      } else {
        console.log('[OTA] No update available');
        resetState();
      }
    } catch (error) {
      console.error('[OTA] Error checking for updates:', error);
      setState(prev => ({ 
        ...prev, 
        isChecking: false, 
        error: error instanceof Error ? error.message : 'Failed to check for updates'
      }));
    }
  }, [resetState]);

  const downloadAndRestart = useCallback(async () => {
    if (!state.isUpdateAvailable) return;

    try {
      setState(prev => ({ ...prev, isDownloading: true, error: null }));

      // Download the update with progress tracking
      const downloadResumable = Updates.fetchUpdateAsync();
      
      // Note: expo-updates doesn't currently support progress callbacks
      // This is a placeholder for future implementation
      await downloadResumable;

      setState(prev => ({ ...prev, progress: 100 }));

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
    checkForUpdate,
    downloadAndRestart,
    dismissUpdate,
  };
}