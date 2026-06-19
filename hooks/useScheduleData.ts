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

export function useScheduleData(
  selectedMeet: MeetName | null,
): UseScheduleDataReturn {
  const params = useMemo(
    () => (selectedMeet ? ([selectedMeet] as [MeetName]) : null),
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
    params: params ?? ([] as unknown as [MeetName]),
    initialData: emptySchedule,
    enabled: Boolean(params),
  });

  const initialScrollIndex = useMemo(() => {
    if (!schedule.length) return 0;
    return calculateInitialPage(schedule);
  }, [schedule]);

  return {
    schedule,
    isLoading: isInitialLoading,
    isRefreshing,
    initialScrollIndex,
    refreshSchedule: refresh,
  };
}
