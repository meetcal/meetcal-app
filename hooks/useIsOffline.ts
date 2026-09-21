import { useEffect, useState } from "react";

import {
  isNetworkAvailable,
  subscribeToNetworkChanges,
} from "@/lib/networkUtils";

/**
 * Whether the device is currently believed to be offline.
 *
 * Six screens (`clubs-list`, `meets-list`, club `results`, `all-meet-results`,
 * `weightlifting-wrapped`, `national-rankings`) each carried the same mount
 * check + `subscribeToNetworkChanges` subscription + mounted flag, written two
 * different ways. One copy is enough: `lib/networkUtils` already de-duplicates
 * and caches the underlying NetInfo probe, so a screen never pays for the
 * check twice.
 *
 * The setter is returned because a screen that has just made a request knows
 * the answer before the NetInfo listener does (`all-meet-results` short-circuits
 * a search on a failed reachability check). Treat it as a correction to the
 * subscription, never as the source of truth.
 */
export function useIsOffline(): [boolean, (isOffline: boolean) => void] {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    let mounted = true;

    isNetworkAvailable()
      .then((hasNetwork) => {
        if (mounted) setIsOffline(!hasNetwork);
      })
      .catch(() => {
        if (mounted) setIsOffline(false);
      });

    const unsubscribe = subscribeToNetworkChanges((isConnected) => {
      setIsOffline(!isConnected);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return [isOffline, setIsOffline];
}
