import { useMemo, useState } from "react";
import {
  clearMeetSchedule,
  getMeetSchedule,
  saveMeetSchedule,
} from "@/lib/database/offline-store";
import { MeetName } from "@/data/types/meet";
import { Schedule } from "@/types/schedule";
import { calculateInitialPage } from "@/utils/dateTime";
import { createMutableResource, defaultIsEqual } from "@/lib/data/mutable-resource";
import { getCachedMeetByName } from "@/lib/database/meet-manager";
import { fetchSchedule } from "@/lib/database/queries";
import { useMutableResource } from "@/hooks/useMutableResource";

interface UseScheduleDataReturn {
  schedule: Schedule;
  isLoading: boolean;
  isRefreshing: boolean;
  initialScrollIndex: number;
  refreshSchedule: () => Promise<void>;
}

const scheduleResource = createMutableResource<Schedule, [MeetName]>({
  getKey: (meet) => `schedule:${meet}`,
  loadCached: async (meet) => {
    const schedule = await getMeetSchedule(meet);
    if (schedule.length === 0) {
      return null;
    }
    return {
      data: schedule,
      lastUpdatedAt: null,
    };
  },
  // The meets list is cached before a meet can be selected, so the schedule
  // fetch skips its `/meets/details` companion request whenever it can.
  fetchFresh: async (meet) => fetchSchedule(meet, await getCachedMeetByName(meet)),
  persistFresh: async (data, meet) => {
    // An empty response is not a command to delete the offline copy. This used
    // to call `clearMeetSchedule(meet)`, so one `200 []` from
    // `/meets/schedule` — rows briefly unpublished, a re-import, a backend
    // filter bug — permanently destroyed a schedule the user had explicitly
    // downloaded for offline use, and the next launch in airplane mode had
    // nothing to fall back on. Every other writer takes the opposite stance
    // for the same payload: `saveMeetSchedule` rejects an empty schedule
    // outright, and both prefetch paths in `meet-manager` guard on
    // `schedule.length > 0`. Explicit invalidation still goes through
    // `clearCached` below.
    if (data.length === 0) {
      return null;
    }

    await saveMeetSchedule(meet, data);
    return { data, lastUpdatedAt: Date.now() };
  },
  clearCached: async (meet) => {
    await clearMeetSchedule(meet);
  },
  isEqual: defaultIsEqual,
});

/**
 * @param timeZoneIdentifier The meet's IANA timezone, used to decide which day
 * the schedule opens on. Optional because the meet details can still be
 * loading; `calculateInitialPage` falls back to UTC in that case.
 */
export function useScheduleData(
  selectedMeet: MeetName | null,
  timeZoneIdentifier?: string,
): UseScheduleDataReturn {
  const params = useMemo<[MeetName] | null>(
    () => (selectedMeet ? [selectedMeet] : null),
    [selectedMeet],
  );
  const [emptySchedule] = useState<Schedule>([]);
  const {
    data: schedule,
    isInitialLoading,
    isRefreshing,
    refresh,
  } = useMutableResource({
    resource: scheduleResource,
    params,
    initialData: emptySchedule,
  });

  const initialScrollIndex = useMemo(() => {
    if (!schedule.length) return 0;
    return calculateInitialPage(schedule, timeZoneIdentifier);
  }, [schedule, timeZoneIdentifier]);

  return {
    schedule,
    isLoading: isInitialLoading,
    isRefreshing,
    initialScrollIndex,
    refreshSchedule: refresh,
  };
}
