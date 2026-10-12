import { useEffect, useState, useCallback, useRef } from 'react';
import * as Updates from 'expo-updates';
import { Alert, AppState, Platform } from 'react-native';
import { isNetworkAvailable } from '@/lib/networkUtils';
import { devLog } from '@/lib/logger';

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

/**
 * The update the user said "Later" to this session. `null` id: the check
 * reported no manifest id, so the dismissal covers any update. Module state,
 * so a remount of the root (sign-out) does not forget it.
 */
let dismissedUpdate: { id: string | null } | null = null;

/** Test seam: module state outlives a test otherwise. */
export function resetOTADismissalForTests(): void {
  dismissedUpdate = null;
}

/**
 * Whether a check result should put the update prompt on screen.
 *
 * `app.config.js` checks `ON_LOAD` with `fallbackToCacheTimeout: 0`, so
 * expo-updates already downloads a new update in the background and applies
 * it on the next launch; the prompt only offers to apply it sooner. It used
 * to reappear on every foreground more than five minutes apart, all through a
 * meet day, because `checkForUpdateAsync` keeps reporting the update until
 * the app restarts. Not once the update is downloaded (it applies on the next
 * launch anyway), and not again for an update the user put off. A different
 * update than the downloaded one is still a new question.
 */
export function shouldPromptForUpdate({
  isAvailable,
  updateId,
  isUpdatePending,
  downloadedUpdateId = null,
  dismissed,
}: {
  isAvailable: boolean;
  updateId: string | null;
  isUpdatePending: boolean;
  /** `useUpdates().downloadedUpdate?.updateId`; `null` when unknown. */
  downloadedUpdateId?: string | null;
  dismissed: { id: string | null } | null;
}): boolean {
  if (!isAvailable) return false;
  if (isPendingUpdate({ updateId, isUpdatePending, downloadedUpdateId })) return false;
  if (dismissed && (dismissed.id === null || dismissed.id === updateId)) return false;
  return true;
}

/**
 * Whether `updateId` is the update expo-updates has already downloaded. An
 * unidentified download (or an unidentified update) counts as a match, so
 * the prompt errs towards staying quiet.
 */
function isPendingUpdate({
  updateId,
  isUpdatePending,
  downloadedUpdateId,
}: {
  updateId: string | null;
  isUpdatePending: boolean;
  downloadedUpdateId: string | null;
}): boolean {
  if (!isUpdatePending) return false;
  return downloadedUpdateId === null || updateId === null || downloadedUpdateId === updateId;
}

export function useOTAUpdates(): OTAUpdateState & OTAUpdateActions {
  const [state, setState] = useState<OTAUpdateState>({
    isDownloading: false,
    isUpdateAvailable: false,
    error: null,
  });
  // Read from the check callback without re-creating it on every native
  // state change.
  const { isUpdatePending, downloadedUpdate } = Updates.useUpdates();
  const downloadedUpdateId = downloadedUpdate?.updateId ?? null;
  const pendingRef = useRef({ isUpdatePending, downloadedUpdateId });
  useEffect(() => {
    pendingRef.current = { isUpdatePending, downloadedUpdateId };
  }, [isUpdatePending, downloadedUpdateId]);
  // The id of the update the prompt is showing, for "Later".
  const promptedUpdateIdRef = useRef<string | null>(null);

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

  // Take the prompt down once the update it offers is downloaded. Skipped
  // while the user's own download is running: that path ends in the restart
  // alert, whose buttons clear the modal.
  const withdrawPrompt = useCallback(() => {
    if (!isMountedRef.current) return;
    setState(prev =>
      prev.isUpdateAvailable && !prev.isDownloading
        ? { ...prev, isUpdateAvailable: false }
        : prev,
    );
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
      devLog('[OTA] Skipping update check in development mode');
      return;
    }

    // Only check for updates if the app was loaded from a bundle
    if (!Updates.isEnabled) {
      devLog('[OTA] Updates are not enabled');
      return;
    }

    // Check network connectivity before attempting update check
    const hasNetwork = await isNetworkAvailable();
    if (!hasNetwork) {
      devLog('[OTA] Skipping update check - no network available');
      return; // Silently skip, don't show error to user
    }

    try {
      const update = await Updates.checkForUpdateAsync();
      if (!isMountedRef.current) return;

      const updateId = update.isAvailable ? update.manifest.id ?? null : null;
      if (
        shouldPromptForUpdate({
          isAvailable: update.isAvailable,
          updateId,
          isUpdatePending: pendingRef.current.isUpdatePending,
          downloadedUpdateId: pendingRef.current.downloadedUpdateId,
          dismissed: dismissedUpdate,
        })
      ) {
        devLog('[OTA] Update available');
        promptedUpdateIdRef.current = updateId;
        setState(prev => ({ ...prev, isUpdateAvailable: true }));
      } else if (update.isAvailable) {
        // A prompt raised before expo-updates finished its background
        // download would otherwise stay up offering a finished download.
        devLog('[OTA] Update available but already downloaded or put off');
        withdrawPrompt();
      } else {
        devLog('[OTA] No update available');
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
  }, [resetState, withdrawPrompt]);

  // The background download can finish while the prompt is up, with no
  // foreground check to notice.
  useEffect(() => {
    if (
      isPendingUpdate({
        updateId: promptedUpdateIdRef.current,
        isUpdatePending,
        downloadedUpdateId,
      })
    ) {
      withdrawPrompt();
    }
  }, [isUpdatePending, downloadedUpdateId, withdrawPrompt]);

  // "Later", from the prompt or from the restart alert: take the prompt down
  // and do not raise it again this session for the same update.
  const dismissUpdate = useCallback(() => {
    dismissedUpdate = { id: promptedUpdateIdRef.current };
    if (!isMountedRef.current) return;
    setState(prev => ({
      ...prev,
      isUpdateAvailable: false,
      isDownloading: false,
      error: null,
    }));
  }, []);

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
            // `resetState` left `isUpdateAvailable` true, so the update
            // modal stayed up behind the alert and needed a second dismiss.
            // The downloaded update applies on the next launch.
            text: 'Later',
            style: 'cancel',
            onPress: () => dismissUpdate(),
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
  }, [state.isUpdateAvailable, dismissUpdate]);

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