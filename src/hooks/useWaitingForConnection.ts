import { useEffect, useState } from "react";

import { WAITING_FOR_CONNECTION_AFTER_MS } from "@/lib/api/network-policy";

export const WAITING_FOR_CONNECTION_LABEL = "Waiting for Connection";

export function useWaitingForConnection(isWaitingForData: boolean): boolean {
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    if (!isWaitingForData) {
      setWaited(false);
      return;
    }
    const timer = setTimeout(() => setWaited(true), WAITING_FOR_CONNECTION_AFTER_MS);
    return () => clearTimeout(timer);
  }, [isWaitingForData]);

  return isWaitingForData && waited;
}

export function useLoadingText(label: string): string {
  return useWaitingForConnection(true) ? WAITING_FOR_CONNECTION_LABEL : label;
}
