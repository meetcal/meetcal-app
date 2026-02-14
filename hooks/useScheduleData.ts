import { useState, useCallback, useEffect } from "react";
import { getMeetData } from "@/lib/database/offline-store";
import { MeetName } from "@/data/types/meet";
import { Schedule } from "@/types/schedule";
import { calculateInitialPage } from "@/utils/dateTime";

interface UseScheduleDataOptions {
  showLoading?: boolean;
}

interface UseScheduleDataReturn {
  schedule: Schedule;
  isLoading: boolean;
  isRefreshing: boolean;
  initialScrollIndex: number;
  loadSchedule: (
    meet: MeetName,
    options?: UseScheduleDataOptions,
  ) => Promise<void>;
  refreshSchedule: () => Promise<void>;
  setSchedule: (schedule: Schedule) => void;
}

export function useScheduleData(
  selectedMeet: MeetName | null,
): UseScheduleDataReturn {
  const [schedule, setSchedule] = useState<Schedule>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [initialScrollIndex, setInitialScrollIndex] = useState(0);

  // Load schedule from cache (context handles syncing)
  const loadSchedule = useCallback(
    async (meet: MeetName, options?: UseScheduleDataOptions) => {
      const showLoading = options?.showLoading ?? true;
      if (showLoading) setIsLoading(true);
      let scheduleData: Schedule = [];

      try {
        // Get cached data - context's SyncManager handles fetching/syncing
        const cachedMeetData = await getMeetData(meet);
        if (cachedMeetData?.schedule) {
          scheduleData = cachedMeetData.schedule;
        } else {
          console.log(`useScheduleData: No schedule found in cache for ${meet}`);
        }
      } catch (cacheError) {
        console.error(
          `useScheduleData: Failed to load schedule from cache for ${meet}:`,
          cacheError,
        );
      }

      setSchedule(scheduleData);

      // Calculate and set the initial page based on current UTC date
      if (scheduleData && scheduleData.length > 0) {
        const initialPage = calculateInitialPage(scheduleData);
        setInitialScrollIndex(initialPage);
      }

      if (showLoading) setIsLoading(false);
    },
    [],
  );

  // Refresh handler
  const refreshSchedule = useCallback(async () => {
    if (selectedMeet && typeof selectedMeet === "string") {
      setIsRefreshing(true);
      try {
        await loadSchedule(selectedMeet as MeetName, { showLoading: false });
      } finally {
        setIsRefreshing(false);
      }
    } else {
      console.log("Refresh skipped: No meet selected");
    }
  }, [selectedMeet, loadSchedule]);

  // Load data when selectedMeet changes
  useEffect(() => {
    if (selectedMeet && typeof selectedMeet === "string") {
      // Ensure selectedMeet is treated as MeetName type
      loadSchedule(selectedMeet as MeetName);
    } else {
      // Clear schedule if no meet is selected
      setSchedule([]);
      setInitialScrollIndex(0);
      setIsLoading(false);
    }
  }, [selectedMeet, loadSchedule]);

  return {
    schedule,
    isLoading,
    isRefreshing,
    initialScrollIndex,
    loadSchedule,
    refreshSchedule,
    setSchedule,
  };
}
