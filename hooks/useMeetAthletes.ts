import { useMemo, useState } from "react";

import { MeetName } from "@/data/types/meet";
import { LiftResult } from "@/data/types/athletes";
import { useMutableResource } from "@/hooks/useMutableResource";
import { filterSessionAthletes } from "@/lib/athletes";
import { createMutableResource, defaultIsEqual } from "@/lib/data/mutable-resource";
import {
  getMeetData,
  getSessionAthletesFromMeetCache,
  saveSessionAthletes,
} from "@/lib/database/offline-store";
import { fetchAthletesWithSession } from "@/lib/database/queries";

interface UseMeetAthletesReturn {
  athletes: LiftResult[];
  isLoading: boolean;
  isRefreshing: boolean;
  refreshAthletes: () => Promise<void>;
}

const sessionAthletesResource = createMutableResource<
  LiftResult[],
  [MeetName, number, string]
>({
  getKey: (meet, sessionNumber, platform) =>
    `athletes:${meet}:session:${sessionNumber}:${platform}`,
  loadCached: async (meet, sessionNumber, platform) => {
    const athletes = await getSessionAthletesFromMeetCache(
      meet,
      sessionNumber,
      platform,
    );
    if (athletes.length > 0) {
      return {
        data: athletes,
        lastUpdatedAt: Date.now(),
      };
    }

    const meetData = await getMeetData(meet);
    const sessionAthletes = filterSessionAthletes(
      meetData.athletes,
      sessionNumber,
      platform,
    );
    return sessionAthletes.length > 0
      ? {
          data: sessionAthletes,
          lastUpdatedAt: meetData.lastSyncTime || null,
        }
      : null;
  },
  fetchFresh: async (meet, sessionNumber, platform) =>
    filterSessionAthletes(
      await fetchAthletesWithSession(meet, sessionNumber, platform),
      sessionNumber,
      platform,
    ),
  persistFresh: async (data, meet, sessionNumber, platform) => {
    await saveSessionAthletes(meet, sessionNumber, platform, data);
    return { data, lastUpdatedAt: Date.now() };
  },
  isEqual: defaultIsEqual,
});

export function useSessionAthletes(
  selectedMeet: MeetName | null,
  sessionNumber: number,
  platform: string,
): UseMeetAthletesReturn {
  const params = useMemo(
    () =>
      selectedMeet
        ? ([selectedMeet, sessionNumber, platform] as [MeetName, number, string])
        : null,
    [platform, selectedMeet, sessionNumber],
  );
  const [emptyAthletes] = useState<LiftResult[]>([]);
  const {
    data: athletes,
    isInitialLoading,
    isRefreshing,
    refresh,
  } = useMutableResource({
    resource: sessionAthletesResource,
    params: params ?? ([] as unknown as [MeetName, number, string]),
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
