import { useMemo } from 'react';

import type { MeetName } from '@/data/types/meet';
import { useScheduleData } from '@/hooks/useScheduleData';
import {
  buildSessionScheduleLookup,
  savedScheduleMeet,
  type SessionLookupByMeet,
} from '@/lib/saved-schedule-lookup';

/**
 * Schedule rows for the Saved tab's cards and calendar export.
 *
 * Reads the selected meet's schedule through the same resource as the
 * Schedule tab (`useScheduleData`): the offline copy paints first, the
 * revalidation joins any request already in flight for that meet, and the
 * fetch reuses the cached meet instead of a `/meets/details` round trip.
 */
export function useSavedScheduleLookup(
  savedSessions: readonly { meet?: string | null }[],
  selectedMeet: MeetName | null,
  allowedMeetNames: ReadonlySet<string>,
): { sessionLookupByMeet: SessionLookupByMeet; isLoading: boolean } {
  const meet = savedScheduleMeet(savedSessions, selectedMeet, allowedMeetNames);
  const { schedule, isLoading } = useScheduleData(meet);

  const sessionLookupByMeet = useMemo<SessionLookupByMeet>(() => {
    const byMeet: SessionLookupByMeet = new Map();
    // No entry for an empty schedule: the calendar export then reports the
    // sessions as missing schedule details instead of exporting nothing.
    if (meet && schedule.length > 0) {
      byMeet.set(meet, buildSessionScheduleLookup(schedule));
    }
    return byMeet;
  }, [meet, schedule]);

  return { sessionLookupByMeet, isLoading };
}
