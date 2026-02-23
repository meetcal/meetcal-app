import { useMemo } from "react";
import { getDateInTimeZone } from "@/utils/dateTime";
import { Meet } from "@/data/types/meet";

interface UseUpcomingMeetsParams {
  availableMeets: Meet[];
  monthsRange?: number;
}

interface UseUpcomingMeetsReturn {
  upcomingMeets: Meet[];
}

export function useUpcomingMeets({
  availableMeets,
  monthsRange = 3,
}: UseUpcomingMeetsParams): UseUpcomingMeetsReturn {
  const upcomingMeets = useMemo(() => {
    const startOfToday = getDateInTimeZone("America/Los_Angeles");
    const rangeStart = new Date(startOfToday);
    rangeStart.setDate(1);
    rangeStart.setMonth(rangeStart.getMonth() - monthsRange);
    const rangeEnd = new Date(startOfToday);
    rangeEnd.setDate(1);
    rangeEnd.setMonth(rangeEnd.getMonth() + monthsRange + 1);
    rangeEnd.setDate(0); // last day of the target month

    return availableMeets
      .filter((meet) => {
        const start = new Date(meet.dates?.start ?? "");
        const end = new Date(meet.dates?.end ?? meet.dates?.start ?? "");
        if (Number.isNaN(start.getTime())) return false;
        const endDate = Number.isNaN(end.getTime()) ? start : end;
        return endDate >= rangeStart && start <= rangeEnd;
      })
      .sort((a, b) => {
        const startA = new Date(a.dates?.start ?? "").getTime();
        const startB = new Date(b.dates?.start ?? "").getTime();
        return startA - startB;
      });
  }, [availableMeets, monthsRange]);

  return { upcomingMeets };
}
