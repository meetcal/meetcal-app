import { useCallback, useMemo, useState } from "react";
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
  /**
   * Why there is no schedule to show: the load failed (offline included) and
   * nothing is cached. Null while a schedule is shown, so an empty schedule
   * with no error really is "not published yet".
   */
  loadError: string | null;
  /** A revalidate that failed on top of a cached schedule (still shown). */
  refreshError: string | null;
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
  fetchFresh: (meet) => fetchSchedule(meet),
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
    error,
    refreshError,
    isInitialLoading,
    isRefreshing,
    refresh,
  } = useMutableResource({
    resource: scheduleResource,
    params,
    initialData: emptySchedule,
  });

  // The schedule tab's refresh controls take a `Promise<void>`.
  const refreshSchedule = useCallback(async () => {
    await refresh();
  }, [refresh]);

  const initialScrollIndex = useMemo(() => {
    if (!schedule.length) return 0;
    return calculateInitialPage(schedule, timeZoneIdentifier);
  }, [schedule, timeZoneIdentifier]);

  return {
    schedule,
    isLoading: isInitialLoading,
    isRefreshing,
    // `useMutableResource` files a failure under `refreshError` once any
    // answer has rendered, an empty `200 []` included. With nothing on
    // screen that failure is the one to show, or a failed retry would leave
    // "No schedule yet" up.
    loadError: schedule.length === 0 ? (error ?? refreshError) : null,
    refreshError,
    initialScrollIndex,
    refreshSchedule,
  };
}
