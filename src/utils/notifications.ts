import * as Notifications from 'expo-notifications';

import { createSessionDetailsDeepLink } from '@/utils/deepLinks';
import { devLog } from '@/lib/logger';

/**
 * AsyncStorage key for the "notify me about saved sessions" preference.
 * Onboarding, profile settings and `useSavedSessions` all read/write it, so it
 * lives here rather than as a literal in each of them.
 */
export const NOTIFICATION_ENABLED_KEY = '@notification_enabled';

/**
 * AsyncStorage key set once the OS notification permission prompt has been
 * shown (onboarding or the Profile switch). Whether the user allowed it is
 * the OS's to say; whether reminders are on is `NOTIFICATION_ENABLED_KEY`.
 */
export const NOTIFICATION_PROMPT_SHOWN_KEY = 'hasCheckedNotifications';

/**
 * The Android channel every reminder is delivered on. It is the one the
 * onboarding and profile screens create with `AndroidImportance.MAX`,
 * vibration and a light; a trigger that names no channel lands on
 * expo-notifications' fallback "Miscellaneous" channel instead, which is
 * created at default importance and so shows no heads-up banner. Ignored on
 * iOS.
 */
export const ANDROID_NOTIFICATION_CHANNEL_ID = 'default';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

type SessionNotificationData = {
  id?: string;
  meet?: string;
  sessionNumber?: string | number;
  platform?: string;
  weightClass?: string;
  startTime?: string;
  weighInTime?: string;
  date?: string;
};

export async function scheduleNotification(
  title: string,
  body: string,
  trigger: Date,
  identifier?: string,
  session?: SessionNotificationData,
  extraData?: Record<string, unknown>,
): Promise<string | undefined> {
  const seconds = Math.max(0, Math.floor((trigger.getTime() - Date.now()) / 1000));

  if (seconds <= 0) {
    devLog(`scheduleNotification: Calculated trigger time is in the past or now (${seconds}s). Not scheduling.`);
    return undefined;
  }

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: true,
      priority: Notifications.AndroidNotificationPriority.HIGH,
      data: {
        ...extraData,
        identifier,
        url: session ? createSessionDetailsDeepLink(session) : undefined,
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
      repeats: false,
      channelId: ANDROID_NOTIFICATION_CHANNEL_ID,
    },
    identifier,
  });

  return notificationId;
}

export async function cancelNotification(identifier: string) {
  try {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new Error(`cancelNotification failed: ${err.message}`, { cause: err });
  }
}

/** A pending local notification: its identifier and its content's `data`. */
export interface ScheduledNotificationSummary {
  identifier: string;
  data: Record<string, unknown>;
}

/** Every local notification still waiting to fire. */
export async function listScheduledNotifications(): Promise<ScheduledNotificationSummary[]> {
  const requests = await Notifications.getAllScheduledNotificationsAsync();
  return requests.map((request) => {
    const data: unknown = request.content?.data;
    return {
      identifier: request.identifier,
      data:
        data && typeof data === 'object' && !Array.isArray(data)
          ? (data as Record<string, unknown>)
          : {},
    };
  });
}
