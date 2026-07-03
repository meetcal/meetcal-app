import { NativeModules, Platform } from 'react-native';

let hasLoggedMissingModule = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const REINDEX_DEBOUNCE_MS = 2000;

const performReindex = () => {
  if (Platform.OS !== 'ios') return;

  const module = NativeModules.AppIntentsBridge;
  if (!module?.reindexAppEntities) {
    if (!hasLoggedMissingModule) {
      console.log('[AppIntents] Native module not available');
      hasLoggedMissingModule = true;
    }
    return;
  }

  try {
    const result = module.reindexAppEntities();
    if (result && typeof result.then === 'function') {
      result.catch((error: unknown) => {
        console.warn('[AppIntents] reindexAppEntities failed', error);
      });
    }
  } catch (error) {
    console.warn('[AppIntents] reindexAppEntities threw', error);
  }
};

/**
 * Ask the native App Intents bridge to re-donate/re-index app entities to the
 * iOS 27 Spotlight semantic index. No-ops on non-iOS platforms and when the
 * native module is unavailable (Expo Go / Android / older builds). Errors are
 * caught and logged, never thrown. Rapid calls are debounced since this is
 * triggered from sync paths.
 */
export const reindexAppEntities = (): Promise<void> => {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    performReindex();
  }, REINDEX_DEBOUNCE_MS);

  return Promise.resolve();
};
