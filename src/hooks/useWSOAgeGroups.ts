import { useAgeGroupsByKey } from "@/hooks/useAgeGroupsByKey";
import { fetchWSOAgeGroups } from "@/lib/database/fetch-wso-records";

export function useWSOAgeGroups(currentWSO: string) {
  const { ageGroupsByKey, requestAgeGroups } = useAgeGroupsByKey(
    fetchWSOAgeGroups,
    currentWSO,
  );
  return { ageGroupsByWSO: ageGroupsByKey, requestAgeGroups };
}
