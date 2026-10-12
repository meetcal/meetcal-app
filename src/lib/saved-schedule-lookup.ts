import { isMeetName, type MeetName } from '@/data/types/meet';
import type { SavedSession } from '@/lib/saved-sessions-store';
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

/**
 * `session` with its start time, weigh-in and date taken from the meet's
 * current schedule, or `session` itself (same object) when the schedule has
 * no usable row for it or already agrees.
 *
 * A saved row keeps the start time it had when it was saved, and USAW moves
 * sessions. The Saved card already read the schedule, but the Next Session
 * countdown, the widget, the reminders and the auto-unsave prune read the
 * frozen copy: a session moved from 9:00 AM to 2:00 PM counted down to 9:00,
 * and with auto-unsave on was deleted at 11:00 AM, before it started. Every
 * consumer goes through this so they agree.
 */
export function withScheduleTimes<T extends SavedSession>(
  session: T,
  lookup: ReadonlyMap<string, SessionScheduleLookup> | null | undefined,
): T {
  const row = lookup?.get(makeLookupKey(session.sessionNumber, session.platform));
  if (!row || !row.startTime || !row.fullDate) return session;
  const weighInTime = row.weighInTime || session.weighInTime;
  if (
    row.startTime === session.startTime &&
    row.fullDate === session.date &&
    weighInTime === session.weighInTime
  ) {
    return session;
  }
  return { ...session, startTime: row.startTime, date: row.fullDate, weighInTime };
}

/**
 * `withScheduleTimes` over the rows of `meet`; other meets' rows pass
 * through. Returns `sessions` itself when no row changed, so a schedule
 * refresh that moves nothing does not re-render (or re-sync) its consumers.
 */
export function applyScheduleTimes(
  sessions: SavedSession[],
  meet: MeetName,
  lookup: ReadonlyMap<string, SessionScheduleLookup>,
): SavedSession[] {
  let changed = false;
  const next = sessions.map((session) => {
    if (session.meet !== meet) return session;
    const timed = withScheduleTimes(session, lookup);
    if (timed !== session) changed = true;
    return timed;
  });
  return changed ? next : sessions;
}
