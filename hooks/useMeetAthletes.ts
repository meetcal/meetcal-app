import { useMemo, useState } from "react";

import { MeetName } from "@/data/types/meet";
import { LiftResult } from "@/data/types/athletes";
import { useMutableResource } from "@/hooks/useMutableResource";
import { createMutableResource, defaultIsEqual } from "@/lib/data/mutable-resource";
import { getMeetData, saveMeetAthletes } from "@/lib/database/offline-store";
import { fetchAthletesWithSession } from "@/lib/database/queries";

interface UseMeetAthletesReturn {
  athletes: LiftResult[];
  isLoading: boolean;
  isRefreshing: boolean;
  refreshAthletes: () => Promise<void>;
}

const athletesResource = createMutableResource<LiftResult[], [MeetName]>({
  getKey: (meet) => `athletes:${meet}`,
  loadCached: async (meet) => {
    const meetData = await getMeetData(meet);
    return {
      data: meetData.athletes,
      lastUpdatedAt: meetData.lastSyncTime || null,
    };
  },
  fetchFresh: async (meet) => fetchAthletesWithSession(meet),
  persistFresh: async (data, meet) => {
    await saveMeetAthletes(meet, data);
    return { data, lastUpdatedAt: Date.now() };
  },
  isEqual: defaultIsEqual,
});

export function useMeetAthletes(
  selectedMeet: MeetName | null,
): UseMeetAthletesReturn {
  const params = useMemo(
    () => (selectedMeet ? ([selectedMeet] as const) : null),
    [selectedMeet],
  );
  const [emptyAthletes] = useState<LiftResult[]>([]);
  const {
    data: athletes,
    isInitialLoading,
    isRefreshing,
    refresh,
  } = useMutableResource({
    resource: athletesResource,
    params: params ?? ([] as unknown as [MeetName]),
    initialData: emptyAthletes,
    enabled: Boolean(params),
  });

  return {
    athletes,
    isLoading: isInitialLoading,
    isRefreshing,
    refreshAthletes: refresh,
  };
}
