import { convertToUTC } from "@/data/meets/config";
import { Meet, MeetName } from "@/data/types/meet";
import { SavedSession } from "@/lib/saved-sessions-store";
import { getCalendarDateInTimeZone } from "@/utils/dateTime";

// Show the card for sessions starting in the future, and keep it visible for a
// short grace window (30 min) after a session starts so an in-progress session
// still surfaces.
export const STARTED_GRACE_MS = 30 * 60 * 1000;

/**
 * Today's calendar date (YYYY-MM-DD) in the meet's timezone. Thin alias over
 * the shared helper so this module and `calculateInitialPage` can never
 * disagree about what "today at the meet" means.
 */
export function getTodayInMeetTimeZone(timeZone: string, now: Date = new Date()): string {
  return getCalendarDateInTimeZone(timeZone, now);
}

/**
 * The meet is "today / ongoing" when its backend status says so, or when the
 * current date in the meet's timezone falls within the meet's date range.
 */
export function isMeetTodayOrOngoing(
  meetDetails: Meet,
  timeZone: string,
  now: Date = new Date(),
): boolean {
  if (meetDetails.status === "ongoing") return true;
  const today = getTodayInMeetTimeZone(timeZone, now);
  const start = (meetDetails.dates?.start ?? "").slice(0, 10);
  const end = (meetDetails.dates?.end ?? "").slice(0, 10);
  if (!start || !end) return false;
  return today >= start && today <= end;
}

export type NextSessionSelection = {
  session: SavedSession;
  startMs: number;
};

/**
 * Pick the soonest saved session for the selected meet that is still upcoming,
 * or that started within the grace window. Returns null when the meet isn't
 * today/ongoing, or when nothing qualifies. Uses the shared convertToUTC
 * timezone math rather than re-deriving instants.
 *
 * Every time decision reads `now`. "Is the meet today" used to read the wall
 * clock instead, so the card's ticking `now` and the day check could disagree
 * across the meet-zone midnight, and the function could not be tested
 * without faking the system clock.
 */
export function selectNextSession(
  savedSessions: SavedSession[],
  selectedMeet: MeetName | null,
  meetDetails: Meet | null,
  now: Date,
): NextSessionSelection | null {
  const timeZoneIdentifier = meetDetails?.time.timeZoneIdentifier ?? "";
  if (!selectedMeet || !meetDetails || !timeZoneIdentifier) return null;
  if (!isMeetTodayOrOngoing(meetDetails, timeZoneIdentifier, now)) return null;

  const nowMs = now.getTime();
  let best: NextSessionSelection | null = null;
  for (const session of savedSessions) {
    if (session.meet !== selectedMeet) continue;
    if (!session.startTime || !session.date) continue;

    let startMs: number;
    try {
      startMs = convertToUTC(
        session.startTime,
        session.date,
        timeZoneIdentifier,
      ).getTime();
    } catch {
      continue;
    }
    if (Number.isNaN(startMs)) continue;
    if (startMs <= nowMs - STARTED_GRACE_MS) continue;

    if (!best || startMs < best.startMs) {
      best = { session, startMs };
    }
  }
  return best;
}
