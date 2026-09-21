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
  fetchFresh: async (meet) => fetchSchedule(meet),
  persistFresh: async (data, meet) => {
    if (data.length === 0) {
      await clearMeetSchedule(meet);
      return { data, lastUpdatedAt: Date.now() };
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
