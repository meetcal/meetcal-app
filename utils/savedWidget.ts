import { NativeModules } from 'react-native';
import { SavedSession } from '@/hooks/useSavedSessions';
import { MeetName } from '@/data/types/meet';
import { createSessionDetailsDeepLink } from '@/utils/deepLinks';
import { devLog } from '@/lib/logger';

let hasLoggedMissingWidgetModule = false;

/**
 * Upper bound on rows serialized across the JSON bridge into the
 * memory-limited WidgetKit / Glance extension. This is a safety valve, not a
 * display limit: no widget family shows anything close to this many rows, and
 * a realistic saved list never reaches it.
 */
export const MAX_WIDGET_SESSIONS = 100;

/**
 * Keeps the earliest sessions when (and only when) the list has to be
 * truncated. Under the cap the original order is passed through untouched so
 * the widget sees exactly what it always has.
 */
export function capWidgetSessions(sessions: SavedSession[]): SavedSession[] {
  if (sessions.length <= MAX_WIDGET_SESSIONS) return sessions;
  return [...sessions]
    .sort(
      (a, b) =>
        (a.date ?? '').localeCompare(b.date ?? '') ||
        a.sessionNumber - b.sessionNumber,
    )
    .slice(0, MAX_WIDGET_SESSIONS);
}

/**
 * The widget renders each session's time in the meet's zone, so an identifier
 * the platform cannot resolve would silently render UTC wall-clock times as if
 * they were local. Reject it here and fall back explicitly.
 */
function resolveWidgetTimeZone(timeZone: string | undefined): string {
  if (!timeZone) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    console.warn('[Widget] Unknown time zone, falling back to UTC', timeZone);
    return 'UTC';
  }
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

  const filtered = selectedMeet
    ? capWidgetSessions(
        sessions.filter(session => session.meet === selectedMeet),
      )
    : [];

  const tz = resolveWidgetTimeZone(eventTimezone);
  const widgetSessions = filtered.map(session => ({
    id: session.id,
    meet: session.meet,
    platform: session.platform,
    session_number: session.sessionNumber,
    start_time: session.startTime,
    weigh_in_time: session.weighInTime,
    weight_class: session.weightClass,
    date: session.date,
    time_zone: tz,
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
  }));

  devLog(
    `[Widget] Syncing: meet="${selectedMeet}", sessions=${widgetSessions.length}`,
  );
  
  try {
    module.updateSavedWidget(selectedMeet ?? '', JSON.stringify(widgetSessions));
  } catch (error) {
    console.warn('SavedWidget update failed', error);
  }
};

export const clearSavedWidget = () => {
  const module = NativeModules.SavedWidget;
  if (!module?.clearSavedWidget) return;

  try {
    module.clearSavedWidget();
  } catch (error) {
    console.warn('SavedWidget clear failed', error);
  }
};
