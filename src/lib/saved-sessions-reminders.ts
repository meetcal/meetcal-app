import AsyncStorage from '@react-native-async-storage/async-storage';
import { convertToUTC, getMeetConfig } from '@/data/meets/config';
import { getPlatformStartTime } from '@/data/types/schedule';
import { fetchSchedule } from '@/lib/database/queries';
import type { SavedSession } from '@/lib/saved-sessions-store';
import type { Schedule as ScheduleType, Session as ScheduleSession } from '@/types/schedule';
import {
  cancelNotification,
  NOTIFICATION_ENABLED_KEY,
  scheduleNotification,
} from '@/utils/notifications';
import { calculateWeighInTime } from '@/utils/time';

/**
 * The local "session starts in 1 hour" reminder for a saved session:
 * scheduled after a save, cancelled after a removal. Both are best effort; a
 * failure here is logged and never fails the save or removal.
 */

/** A session reminder fires this long before the session's start time. */
export const NOTIFICATION_LEAD_MS = 60 * 60 * 1000;

/**
 * Saving a session used to emit ~15 `console.log` lines — including the same
 * instant formatted in three timezones — on every save, in production. Keep
 * the trace, keep it out of release builds.
 */
function logNotificationScheduling(step: string, detail?: unknown): void {
  if (!__DEV__) return;
  console.log(`[notifications] ${step}`, detail);
}

/** The user's "notifications enabled" preference. */
export async function readNotificationsEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(NOTIFICATION_ENABLED_KEY)) === 'true';
}

/**
 * The first schedule session numbered `sessionNumber`, with its day's
 * `YYYY-MM-DD` date, or null when the schedule does not have it.
 */
export function findScheduledSession(
  schedule: ScheduleType,
  sessionNumber: number,
): { session: ScheduleSession; date: string } | null {
  for (const day of schedule) {
    const session = day.sessions.find(s => s.number === sessionNumber);
    if (session) {
      return { session, date: day.fullDate }; // YYYY-MM-DD from transformed data
    }
  }
  return null;
}

/** When the reminder for a session starting at `sessionStart` fires. */
export function reminderTriggerDate(sessionStart: Date): Date {
  return new Date(sessionStart.getTime() - NOTIFICATION_LEAD_MS);
}

export interface ReminderOptions {
  /**
   * The meet's schedule when the caller already has it. Only used when
   * non-empty; otherwise the schedule is fetched.
   */
  schedule?: ScheduleType;
  /** The already-read notifications preference; read from storage if absent. */
  notificationsEnabled?: boolean;
}

/**
 * Schedule a local notification 1 hour before the session's start time, if
 * notifications are enabled and that moment is still in the future. The
 * start time comes from the meet's schedule, converted with the meet's time
 * zone (same as calendar events).
 */
export async function scheduleSavedSessionReminder(
  savedSession: SavedSession,
  options?: ReminderOptions,
): Promise<void> {
  try {
    const notificationsEnabled =
      options?.notificationsEnabled ?? (await readNotificationsEnabled());
    logNotificationScheduling('enabled', notificationsEnabled);
    if (!notificationsEnabled) return;

    const meetName = savedSession.meet;
    const sessionNumber = savedSession.sessionNumber;
    const platform = savedSession.platform;
    const providedSchedule =
      options?.schedule && options.schedule.length > 0 ? options.schedule : null;
    logNotificationScheduling(
      providedSchedule ? 'reusing caller schedule' : 'fetching schedule',
      { meetName, sessionNumber, platform },
    );
    const schedule = providedSchedule ?? (await fetchSchedule(meetName));
    logNotificationScheduling('schedule days', schedule?.length ?? 0);

    if (!schedule || schedule.length === 0) {
      console.error(`Notification Scheduling - Could not fetch or schedule is empty for meet: ${meetName}`);
      return; // The session is still saved.
    }

    const found = findScheduledSession(schedule, sessionNumber);
    logNotificationScheduling('session found', found ? found.date : false);
    if (!found || !found.date) return;

    const sessionDayDate = found.date;
    const startTime = getPlatformStartTime(found.session, platform);
    const meetConfig = await getMeetConfig(meetName);
    const sessionDate = convertToUTC(
      startTime,
      sessionDayDate,
      meetConfig.time.timeZoneIdentifier,
    );
    const triggerDate = reminderTriggerDate(sessionDate);
    const now = new Date();

    logNotificationScheduling('trigger', {
      sessionUtc: sessionDate.toISOString(),
      triggerUtc: triggerDate.toISOString(),
      meetZone: meetConfig.time.timeZoneIdentifier,
      willSchedule: triggerDate > now,
    });

    if (triggerDate > now) {
      const notificationId = await scheduleNotification(
        `Session Reminder`,
        `Session ${savedSession.sessionNumber} ${savedSession.platform} starts in 1 hour.`,
        triggerDate,
        savedSession.id,
        {
          id: savedSession.id,
          meet: savedSession.meet,
          sessionNumber: savedSession.sessionNumber,
          platform: savedSession.platform,
          weightClass: savedSession.weightClass,
          startTime,
          weighInTime: calculateWeighInTime(startTime),
          date: sessionDayDate,
        },
      );
      logNotificationScheduling('scheduled', notificationId);
    }
  } catch (notifError) {
    console.error('Notification Scheduling - Error caught during scheduling block:', notifError);
  }
}

/**
 * Cancel the reminder of a removed session. `removed` is the row as it was
 * in storage before the removal, or undefined when it was not there.
 */
export async function cancelSavedSessionReminder(
  sessionId: string,
  removed: SavedSession | undefined,
): Promise<void> {
  if (!removed) {
    console.warn(`removeSession: Could not find session ${sessionId} in storage before removal to cancel notification.`);
    return;
  }
  try {
    // Only cancel if notifications were potentially scheduled.
    if (await readNotificationsEnabled()) {
      await cancelNotification(removed.id);
    }
  } catch (cancelError) {
    console.error(`removeSession: Failed to cancel notification for ${removed.id}:`, cancelError);
    // Continue with removal even if cancellation fails
  }
}
