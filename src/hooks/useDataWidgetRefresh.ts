import { useEffect } from 'react';
import { AppState } from 'react-native';

import { refreshDataWidgets } from '@/lib/data-widgets-refresh';

/**
 * Refreshes the data widgets at launch and whenever the app returns to the
 * foreground. `refreshDataWidgets` shares one in-flight run and throttles
 * repeats, so mounting this once at the root is all it takes.
 */
export function useDataWidgetRefresh(): void {
  useEffect(() => {
    void refreshDataWidgets();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshDataWidgets();
    });
    return () => subscription.remove();
  }, []);
}
