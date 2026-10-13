import { useCallback, useMemo, useState } from "react";
import { MeetName } from "@/data/types/meet";
import { Schedule } from "@/types/schedule";
import { calculateInitialPage } from "@/utils/dateTime";
import { scheduleResource } from "@/lib/database/schedule-resource";
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
