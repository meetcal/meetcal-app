import { useMemo, useState } from "react";

import { MeetName } from "@/data/types/meet";
import { LiftResult } from "@/data/types/athletes";
import { useMutableResource } from "@/hooks/useMutableResource";
import { filterSessionAthletes } from "@/lib/athletes";
import { createMutableResource, defaultIsEqual } from "@/lib/data/mutable-resource";
import {
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
    // The cache reader already falls back to the full meet roster. An empty
    // result must not trigger a second read/decode of that same roster here.
    return athletes.length > 0
      ? { data: athletes, lastUpdatedAt: Date.now() }
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
  const params = useMemo<[MeetName, number, string] | null>(
    () => (selectedMeet ? [selectedMeet, sessionNumber, platform] : null),
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
    params,
    initialData: emptyAthletes,
  });

  return {
    athletes,
    isLoading: isInitialLoading,
    isRefreshing,
    refreshAthletes: refresh,
  };
}
