import { isMeetName, type MeetName } from '@/data/types/meet';
import type { SessionScheduleLookup } from '@/types/saved';
import type { Schedule } from '@/types/schedule';
import { makeLookupKey } from '@/utils/session';
import { calculateWeighInTime } from '@/utils/time';

/** Per-meet `session-platform` → schedule row, as `SessionCard` reads it. */
export type SessionLookupByMeet = Map<MeetName, Map<string, SessionScheduleLookup>>;

/**
 * The one meet whose schedule the Saved tab needs, or `null` for none.
 *
 * The tab lists (and exports to the calendar) only the selected meet's saved
 * sessions, so no other meet's schedule is ever read. It used to fetch every
 * saved meet's schedule — two requests each — on the one screen most often
 * opened in a venue with bad signal, and discarded all but one of them.
 * `null` while nothing is saved for the selected meet: an empty list needs no
 * schedule at all.
 */
export function savedScheduleMeet(
  savedSessions: readonly { meet?: string | null }[],
  selectedMeet: MeetName | null,
  allowedMeetNames: ReadonlySet<string>,
): MeetName | null {
  if (!selectedMeet || !isMeetName(selectedMeet, allowedMeetNames)) return null;
  return savedSessions.some((session) => session.meet === selectedMeet)
    ? selectedMeet
    : null;
}

/**
 * Indexes one meet's schedule by `makeLookupKey(session, platform)`.
 *
 * A platform's own start time wins over the session's. `weighInTime` is ""
 * when the row has no start time, which the card and the calendar export both
 * read as "unknown".
 */
export function buildSessionScheduleLookup(
  schedule: Schedule,
): Map<string, SessionScheduleLookup> {
  const lookup = new Map<string, SessionScheduleLookup>();
  for (const day of schedule) {
    for (const session of day.sessions) {
      for (const platformInfo of session.platforms) {
        const startTime = platformInfo.platformStartTime || session.startTime;
        lookup.set(makeLookupKey(session.number, platformInfo.platform), {
          displayDate: day.date,
          fullDate: day.fullDate,
          startTime,
          weighInTime: calculateWeighInTime(startTime),
          weightClass: platformInfo.weightClass,
        });
      }
    }
  }
  return lookup;
}
