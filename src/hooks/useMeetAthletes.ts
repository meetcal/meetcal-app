import { useMemo, useState } from "react";

import { MeetName } from "@/data/types/meet";
import { LiftResult } from "@/data/types/athletes";
import { useMutableResource } from "@/hooks/useMutableResource";
import { filterSessionAthletes, freshRosterReplacesShown } from "@/lib/athletes";
import { createMutableResource, defaultIsEqual } from "@/lib/data/mutable-resource";
import {
  getSessionAthletesFromMeetCache,
  saveSessionAthletes,
} from "@/lib/database/offline-store";
import { fetchAthletesWithSession } from "@/lib/database/queries";

export interface UseMeetAthletesReturn {
  athletes: LiftResult[];
  isLoading: boolean;
  isRefreshing: boolean;
  /**
   * Why there are no athletes to show: the load failed (offline included)
   * and nothing is cached. Null while athletes are shown.
   */
  loadError: string | null;
  /** A revalidate that failed on top of cached athletes (still shown). */
  refreshError: string | null;
  /** Never rejects; resolves false when the request failed. */
  refreshAthletes: () => Promise<boolean>;
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
    // An empty answer is not saved over a session key: offline, it would
    // read back as "nobody in this session".
    if (data.length === 0) return null;
    await saveSessionAthletes(meet, sessionNumber, platform, data);
    return { data, lastUpdatedAt: Date.now() };
  },
  // The Start List rule: an empty answer (a re-import, a transient filter
  // miss) does not replace the cached athletes on screen.
  keepCached: (cached, fresh) =>
    !freshRosterReplacesShown(fresh.length, cached.length),
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
    error,
    refreshError,
    isInitialLoading,
    isRefreshing,
    refresh,
  } = useMutableResource({
    resource: sessionAthletesResource,
    params,
    initialData: emptyAthletes,
  });

  // Memoized: the session details screen hands this to its athletes card.
  return useMemo(
    () => ({
      athletes,
      isLoading: isInitialLoading,
      isRefreshing,
      // As in `useScheduleData`: after an empty answer, a failed refresh is
      // filed under `refreshError`, and with no athletes shown it is the
      // failure to show.
      loadError: athletes.length === 0 ? (error ?? refreshError) : null,
      refreshError,
      refreshAthletes: refresh,
    }),
    [athletes, error, isInitialLoading, isRefreshing, refresh, refreshError],
  );
}
