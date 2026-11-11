import { useCallback, useEffect, useRef, useState } from "react";

import { sortAgeGroups } from "@/lib/sortAgeGroups";

type FetchAgeGroups = (key: string) => Promise<string[]>;

export function useAgeGroupsByKey(fetchAgeGroups: FetchAgeGroups, currentKey: string) {
  const [ageGroupsByKey, setAgeGroupsByKey] = useState<
    Readonly<Record<string, string[]>>
  >({});
  const requestedOrLoadedKeys = useRef(new Set<string>());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const requestAgeGroups = useCallback(
    (key: string) => {
      if (!key || requestedOrLoadedKeys.current.has(key)) return;
      requestedOrLoadedKeys.current.add(key);

      fetchAgeGroups(key)
        .then((ageGroups) => {
          if (!mountedRef.current) return;
          setAgeGroupsByKey((prev) => ({
            ...prev,
            [key]: sortAgeGroups(ageGroups),
          }));
        })
        .catch((error) => {
          requestedOrLoadedKeys.current.delete(key);
          console.error(`Failed to fetch age groups for ${key}`, error);
        });
    },
    [fetchAgeGroups],
  );

  useEffect(() => {
    requestAgeGroups(currentKey);
  }, [currentKey, requestAgeGroups]);

  return { ageGroupsByKey, requestAgeGroups };
}
