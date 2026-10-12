import { NativeModules } from 'react-native';
import { SavedSession } from '@/hooks/useSavedSessions';
import { MeetName } from '@/data/types/meet';
import { createSessionDetailsDeepLink } from '@/utils/deepLinks';
import { convertZonedLocalToUTC, parseClockTime } from '@/utils/timezone';
import type { SavedWidgetRow } from '@/utils/widgetContract';
import { devLog } from '@/lib/logger';

let hasLoggedMissingWidgetModule = false;

/**
 * Upper bound on rows serialized across the JSON bridge into the
 * memory-limited WidgetKit / Glance extension. This is a safety valve, not a
 * display limit: no widget family shows anything close to this many rows, and
 * a realistic saved list never reaches it.
 */
export const MAX_WIDGET_SESSIONS = 100;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Sorts after any real `YYYY-MM-DD`, so undated rows go last. */
const MISSING_DATE_SORT_KEY = '\uffff';

/** Minutes after meet-local midnight, or `Infinity` for an unreadable time. */
function clockMinutes(time: string | undefined): number {
  if (!time) return Number.POSITIVE_INFINITY;
  try {
    const { hour, minute } = parseClockTime(time);
    return hour * 60 + minute;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Chronological order: meet-local date, then meet-local start time, then
 * session number and platform. All rows belong to one meet, so its wall-clock
 * order is its instant order. Rows missing a date or time go last.
 */
export function compareWidgetSessions(a: SavedSession, b: SavedSession): number {
  const aDate = a.date || MISSING_DATE_SORT_KEY;
  const bDate = b.date || MISSING_DATE_SORT_KEY;
  if (aDate !== bDate) return aDate < bDate ? -1 : 1;
  const aMinutes = clockMinutes(a.startTime);
  const bMinutes = clockMinutes(b.startTime);
  if (aMinutes !== bMinutes) return aMinutes < bMinutes ? -1 : 1;
  if (a.sessionNumber !== b.sessionNumber) return a.sessionNumber - b.sessionNumber;
  return (a.platform ?? '').localeCompare(b.platform ?? '');
}

/**
 * Sorts sessions chronologically and keeps the earliest
 * `MAX_WIDGET_SESSIONS`. The widgets and Siri show the first few rows, so
 * save order (new saves are appended) would hide the next session behind
 * whichever was saved first.
 */
export function capWidgetSessions(sessions: SavedSession[]): SavedSession[] {
  return [...sessions].sort(compareWidgetSessions).slice(0, MAX_WIDGET_SESSIONS);
}

/**
 * The widget hides a session once it starts, so an identifier the platform
 * cannot resolve would compute the wrong start instant. Unknown means
 * unknown: `null`, never a UTC guess, which would hide a US session hours
 * before it starts (the reason `lib/saved-sessions-prune.ts` refuses the same
 * fallback).
 */
function resolveWidgetTimeZone(timeZone: string | undefined): string | null {
  if (!timeZone) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    console.warn('[Widget] Unknown time zone; start instants omitted', timeZone);
    return null;
  }
}

const DAY_LABEL_FORMATTER = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/**
 * "Sat, Jun 20" for a `YYYY-MM-DD` meet date. The date is a calendar date,
 * so it is anchored at UTC midnight and formatted in UTC, never through the
 * device zone (which would shift it a day west of UTC).
 */
export function formatWidgetDayLabel(date: string | undefined): string | undefined {
  const match = date ? ISO_DATE.exec(date) : null;
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // `Date.UTC` rolls Feb 30 over to Mar 2; reject it instead. Day 0 of the
  // next month is this month's last day, leap years included.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return undefined;
  return DAY_LABEL_FORMATTER.format(Date.UTC(year, month - 1, day));
}

/**
 * The session's start instant in epoch ms, or `undefined` when the zone is
 * unknown or the date/time does not convert. The native widgets hide a row
 * once this instant passes and keep rows without one.
 */
export function widgetSessionStartAtMs(
  session: Pick<SavedSession, 'date' | 'startTime'>,
  timeZone: string | null,
): number | undefined {
  if (!timeZone || !session.date || !session.startTime) return undefined;
  try {
    return convertZonedLocalToUTC(session.date, session.startTime, timeZone).getTime();
  } catch {
    return undefined;
  }
}

/** The rows `updateSavedWidget` receives, in display order. */
export function buildSavedWidgetRows(
  sessions: SavedSession[],
  eventTimezone?: string,
): SavedWidgetRow[] {
  const tz = resolveWidgetTimeZone(eventTimezone);
  return capWidgetSessions(sessions).map(session => {
    const row: SavedWidgetRow = {
      id: session.id,
      meet: session.meet,
      platform: session.platform,
      session_number: session.sessionNumber,
      start_time: session.startTime,
      weigh_in_time: session.weighInTime,
      weight_class: session.weightClass,
      date: session.date,
      url: createSessionDetailsDeepLink({
        id: session.id,
        meet: session.meet,
        sessionNumber: session.sessionNumber,
        platform: session.platform,
        weightClass: session.weightClass,
        startTime: session.startTime,
        weighInTime: session.weighInTime,
        date: session.date,
      }),
    };
    const startAtMs = widgetSessionStartAtMs(session, tz);
    if (startAtMs !== undefined) row.start_at_ms = startAtMs;
    const dayLabel = formatWidgetDayLabel(session.date);
    if (dayLabel) row.day_label = dayLabel;
    if (tz) row.time_zone = tz;
    return row;
  });
}

export const syncSavedWidget = (
  selectedMeet: MeetName | null,
  sessions: SavedSession[],
  eventTimezone?: string
) => {
  const module = NativeModules.SavedWidget;
  if (!module?.updateSavedWidget) {
    if (!hasLoggedMissingWidgetModule) {
      devLog('[Widget] Native module not available');
      hasLoggedMissingWidgetModule = true;
    }
    return;
  }

  const widgetSessions = selectedMeet
    ? buildSavedWidgetRows(
        sessions.filter(session => session.meet === selectedMeet),
        eventTimezone,
      )
    : [];

  devLog(
    `[Widget] Syncing: meet="${selectedMeet}", sessions=${widgetSessions.length}`,
  );

  try {
    module.updateSavedWidget(selectedMeet ?? '', JSON.stringify(widgetSessions));
  } catch (error) {
    console.warn('SavedWidget update failed', error);
  }
};

/**
 * Clears the saved-sessions widget (selected meet and sessions) when no user
 * is signed in. The native clear leaves the data widgets alone: they hold
 * public reference data that needs no sign-in.
 */
export const clearSavedWidget = () => {
  const module = NativeModules.SavedWidget;
  if (!module?.clearSavedWidget) return;

  try {
    module.clearSavedWidget();
  } catch (error) {
    console.warn('SavedWidget clear failed', error);
  }
};
