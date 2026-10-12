import { useMemo } from 'react';

import type { MeetName } from '@/data/types/meet';
import { useScheduleData } from '@/hooks/useScheduleData';
import { applyScheduleTimes, buildSessionScheduleLookup } from '@/lib/saved-schedule-lookup';
import type { SavedSession } from '@/lib/saved-sessions-store';

/**
 * `sessions` with the selected meet's rows on its current schedule times
 * (`applyScheduleTimes`), so the Next Session card, the widget and the
 * reminders count down to when the session starts now, not when it started
 * at save time. Reads the same schedule resource as the Schedule tab, and
 * only while something is saved for the selected meet.
 */
export function useScheduleTimedSessions(
  sessions: SavedSession[],
  selectedMeet: MeetName | null,
): SavedSession[] {
  const hasSelectedMeetSessions =
    selectedMeet !== null && sessions.some((session) => session.meet === selectedMeet);
  const { schedule } = useScheduleData(hasSelectedMeetSessions ? selectedMeet : null);

  const lookup = useMemo(
    () => (schedule.length > 0 ? buildSessionScheduleLookup(schedule) : null),
    [schedule],
  );

  return useMemo(
    () =>
      selectedMeet && lookup ? applyScheduleTimes(sessions, selectedMeet, lookup) : sessions,
    [lookup, selectedMeet, sessions],
  );
}
