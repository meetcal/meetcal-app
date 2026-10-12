import { isMeetName, type MeetName } from '@/data/types/meet';
import type { SessionLookupByMeet } from '@/lib/saved-schedule-lookup';
import type { SavedSession } from '@/lib/saved-sessions-store';
import type { CalendarSession } from '@/utils/calendar';
import { makeLookupKey } from '@/utils/session';
import { calculateWeighInTime } from '@/utils/time';

/**
 * The calendar events each screen exports, built in one place. The writing
 * (permission, Android calendar choice, de-duplication, the toast) is
 * `hooks/useCalendarSessionsExport`.
 */

/** One athlete's row in a session, as the Start List export builds it. */
export interface CalendarExportRow {
  sessionNumber: number;
  platform: string;
  /** The meet calendar date, `YYYY-MM-DD`. */
  date: string;
  startTime: string;
  weighInTime: string;
  weightClass: string;
}

/**
 * One event per session and platform. Every weight class lifting in it is
 * named in the event, in first-seen order; the export used to keep only the
 * first row's class.
 */
export function groupCalendarSessions(
  rows: readonly CalendarExportRow[],
  meet: MeetName,
): CalendarSession[] {
  const sessions = new Map<string, { session: CalendarSession; classes: string[] }>();
  for (const row of rows) {
    const key = makeLookupKey(row.sessionNumber, row.platform);
    const weightClass = row.weightClass?.trim() ?? '';
    const existing = sessions.get(key);
    if (existing) {
      if (weightClass && !existing.classes.includes(weightClass)) {
        existing.classes.push(weightClass);
      }
      continue;
    }
    sessions.set(key, {
      session: {
        date: row.date,
        startTime: row.startTime,
        weighInTime: row.weighInTime,
        sessionNumber: row.sessionNumber.toString(),
        platform: row.platform,
        weightClass: '',
        meet,
      },
      classes: weightClass ? [weightClass] : [],
    });
  }
  return Array.from(sessions.values(), ({ session, classes }) => ({
    ...session,
    weightClass: classes.join(', '),
  }));
}

/**
 * The Saved tab's events: each saved session on its current schedule row.
 * A session whose meet has no schedule loaded, or whose row lacks a date or
 * time, cannot be placed on a calendar; it is counted in `skipped` so the
 * toast can say "Added N of M" instead of claiming every session was added.
 */
export function calendarSessionsFromSaved(
  sessions: readonly SavedSession[],
  lookupByMeet: SessionLookupByMeet,
  allowedMeetNames: ReadonlySet<string>,
): { sessions: CalendarSession[]; skipped: number } {
  const events: CalendarSession[] = [];
  for (const session of sessions) {
    if (!session.meet || !isMeetName(session.meet, allowedMeetNames)) continue;
    const meetLookup = lookupByMeet.get(session.meet);
    if (!meetLookup) continue;
    const lookup = meetLookup.get(makeLookupKey(session.sessionNumber, session.platform));
    const startTime = lookup?.startTime || session.startTime;
    const weighInTime =
      lookup?.weighInTime || calculateWeighInTime(startTime) || session.weighInTime;
    const date = lookup?.fullDate || '';
    if (!date || !startTime || !weighInTime) continue;
    events.push({
      date,
      startTime,
      weighInTime,
      sessionNumber: session.sessionNumber.toString(),
      platform: session.platform,
      weightClass: lookup?.weightClass || session.weightClass,
      meet: session.meet,
    });
  }
  return { sessions: events, skipped: sessions.length - events.length };
}
