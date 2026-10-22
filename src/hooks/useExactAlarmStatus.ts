import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { type ExactAlarmStatus, readExactAlarmStatus } from '@/lib/exact-alarms';

/**
 * The exact-alarm permission (`lib/exact-alarms.ts`), read on mount and
 * again whenever the app returns to the foreground, so it updates after the
 * user comes back from Android's "Alarms & reminders" page. `null` until the
 * first read lands.
 */
export function useExactAlarmStatus(): ExactAlarmStatus | null {
  const [status, setStatus] = useState<ExactAlarmStatus | null>(null);

  useEffect(() => {
    let isCancelled = false;
    // Only the latest read may land: an older one can resolve after it.
    let latestRead = 0;
    const read = () => {
      latestRead += 1;
      const thisRead = latestRead;
      void readExactAlarmStatus().then((next) => {
        if (!isCancelled && thisRead === latestRead) setStatus(next);
      });
    };
    read();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') read();
    });
    return () => {
      isCancelled = true;
      subscription.remove();
    };
  }, []);

  return status;
}
