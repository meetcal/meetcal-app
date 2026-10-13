import type { LiftResult } from '@/data/types/athletes';
import { isMeetName, type MeetName } from '@/data/types/meet';
import type { SessionLookupByMeet } from '@/lib/saved-schedule-lookup';
import type { SavedSession } from '@/lib/saved-sessions-store';
import type { CalendarSession } from '@/utils/calendar';
import { makeLookupKey } from '@/utils/session';
import { resolveWeighInTime } from '@/utils/time';
import { parseClockTime, parseMeetCalendarDay } from '@/utils/timezone';

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
 * Whether a session can be placed on a calendar: a meet calendar date and a
 * start time the event writer can convert. A schedule row with no start time
 * yet (`formatApiTime` maps it to "") used to reach the writer, which threw,
 * and the toast said to try again, which could never succeed.
 */
export function hasCalendarTimes(date: string, startTime: string): boolean {
  // A placeholder date (`TBD`) or a day that doesn't exist is rejected by
  // the writer too; skip it here so the toast counts it, not a failure.
  if (!date || !startTime || !parseMeetCalendarDay(date)) return false;
  try {
    parseClockTime(startTime);
    return true;
  } catch {
    return false;
  }
}

/** The calendar events an export writes, and the sessions it had to leave out. */
export interface CalendarExportPlan {
  sessions: CalendarSession[];
  /** Sessions with no schedule row, date or start time; "Added N of M" counts them. */
  skipped: number;
}

/**
 * One event per session and platform. Every weight class lifting in it is
 * named in the event, in first-seen order; the export used to keep only the
 * first row's class.
 *
 * A session the schedule has not timed yet is left out and counted in
 * `skipped`, as are the sessions of `unscheduled` athletes (entered in a
 * session the schedule has no row for), so the toast says "Added N of M"
 * like the Saved tab's export does.
 */
export function groupCalendarSessions(
  rows: readonly CalendarExportRow[],
  meet: MeetName,
  unscheduled: readonly LiftResult[] = [],
): CalendarExportPlan {
  const sessions = new Map<string, { session: CalendarSession; classes: string[] }>();
  const untimed = new Set<string>();
  for (const row of rows) {
    const key = makeLookupKey(row.sessionNumber, row.platform);
    if (!hasCalendarTimes(row.date, row.startTime)) {
      untimed.add(key);
      continue;
    }
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
  const unplaced = new Set(untimed);
  for (const athlete of unscheduled) {
    if (athlete.session) unplaced.add(makeLookupKey(athlete.session.number, athlete.session.platform));
  }
  return {
    sessions: Array.from(sessions.values(), ({ session, classes }) => ({
      ...session,
      weightClass: classes.join(', '),
    })),
    skipped: unplaced.size,
  };
}

/**
 * The Saved tab's events: each saved session on its current schedule row.
 * A session whose meet has no schedule loaded, or whose row lacks a date or
 * start time, cannot be placed on a calendar (an unknown weigh-in is only
 * left out of the event's notes); it is counted in `skipped` so the
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
    // The schedule row's start, even when blank: a row the schedule has
    // stopped timing is untimed now, not at the time it was saved with. (No
    // row at all has no date either, so it is skipped below.)
    const startTime = lookup ? lookup.startTime : session.startTime;
    // The schedule's weigh-in (published, else start minus 2 h); without a
    // timed row, the saved pair, which was resolved by the same rule.
    const weighInTime =
      lookup?.weighInTime || resolveWeighInTime(session.startTime, session.weighInTime);
    const date = lookup?.fullDate || '';
    if (!hasCalendarTimes(date, startTime)) continue;
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
