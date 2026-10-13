import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/**
 * Call `refresh` each time the app comes back to the foreground (`active`
 * after `background` or `inactive`), while `enabled`. The process can stay
 * suspended for days during a meet, and nothing else reloads data the user
 * changed on another device while it slept; the caller throttles.
 *
 * `refresh` is read through a ref, so a new identity does not resubscribe.
 */
export function useForegroundRefresh(enabled: boolean, refresh: () => Promise<unknown>): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!enabled) return;
    let previous: string | null | undefined = AppState.currentState;
    const subscription = AppState.addEventListener('change', (state) => {
      const wasActive = previous === 'active';
      previous = state;
      if (state !== 'active' || wasActive) return;
      void refreshRef.current().catch((error: unknown) => {
        console.error('Saved sessions: foreground refresh failed', error);
      });
    });
    return () => subscription.remove();
  }, [enabled]);
}
