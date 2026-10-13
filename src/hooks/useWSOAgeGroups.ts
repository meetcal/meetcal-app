import { useCallback, useEffect, useRef, useState } from "react";

import { fetchWSOAgeGroups } from "@/lib/database/fetch-wso-records";
import { sortAgeGroups } from "@/lib/sortAgeGroups";

/**
 * Every age group a WSO has records in, per WSO, for the WSO Records filter
 * sheet. The list comes from `fetchWSOAgeGroups`, which is not narrowed by
 * the selected age group or gender. The screen's records payload is, so
 * taking the options from its keys offered only the age group already shown
 * (#267).
 *
 * The current WSO is loaded on its own; `requestAgeGroups` loads one picked
 * in the sheet. Each WSO is fetched once; a failed fetch is retried on the
 * next request for it.
 */
export function useWSOAgeGroups(currentWSO: string) {
  const [ageGroupsByWSO, setAgeGroupsByWSO] = useState<
    Readonly<Record<string, string[]>>
  >({});
  const requestedRef = useRef(new Set<string>());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const requestAgeGroups = useCallback((wso: string) => {
    if (!wso || requestedRef.current.has(wso)) return;
    requestedRef.current.add(wso);

    fetchWSOAgeGroups(wso)
      .then((ageGroups) => {
        if (!mountedRef.current) return;
        setAgeGroupsByWSO((prev) => ({
          ...prev,
          [wso]: sortAgeGroups(ageGroups),
        }));
      })
      .catch((error) => {
        requestedRef.current.delete(wso);
        console.error(`Failed to fetch age groups for ${wso}`, error);
      });
  }, []);

  useEffect(() => {
    requestAgeGroups(currentWSO);
  }, [currentWSO, requestAgeGroups]);

  return { ageGroupsByWSO, requestAgeGroups };
}
