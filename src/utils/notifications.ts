import * as Notifications from 'expo-notifications';
// Named import: eslint-plugin-import cannot see enums re-exported through
// expo-notifications' nested `export *` chain on the namespace object.
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

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
 * The Android channel every reminder is delivered on, created by
 * `ensureReminderChannel` with `AndroidImportance.MAX`, vibration and a light.
 * A trigger that names a channel that does not exist lands on
 * expo-notifications' fallback "Miscellaneous" channel instead, which is
 * created at default importance and so shows no heads-up banner. Ignored on
 * iOS.
 *
 * The id stays `default`: installs that already have it (created by earlier
 * builds at the same importance) keep the user's choices for it, and only its
 * name changes. Android lets an app rename a channel, never raise its
 * importance, so a new id would gain nothing.
 */
export const ANDROID_NOTIFICATION_CHANNEL_ID = 'default';

/** The channel's name in Android's notification settings. */
export const ANDROID_NOTIFICATION_CHANNEL_NAME = 'Session reminders';

let reminderChannelReady: Promise<void> | null = null;

/**
 * Create (or rename) the reminders channel. Run once at startup and awaited
 * before every reminder and permission prompt, so it exists however the user
 * reached reminders. It used to be created only by onboarding's Done button
 * and the Profile switch, so a subscriber who backed out of onboarding and
 * never opened Profile had reminders posted to the fallback channel. On
 * Android 13+ a channel must also exist before the permission prompt shows.
 * Calling it for an existing channel only updates its name. A failure is
 * logged and retried on the next call; it never fails a caller.
 */
export function ensureReminderChannel(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  reminderChannelReady ??= Notifications.setNotificationChannelAsync(
    ANDROID_NOTIFICATION_CHANNEL_ID,
    {
      name: ANDROID_NOTIFICATION_CHANNEL_NAME,
      importance: AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    },
  ).then(
    () => undefined,
    (error: unknown) => {
      reminderChannelReady = null;
      console.error('Notifications: could not create the reminders channel', error);
    },
  );
  return reminderChannelReady;
}

/** Forget the created channel. For tests. */
export function resetReminderChannelForTests(): void {
  reminderChannelReady = null;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

void ensureReminderChannel();

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

/**
 * Schedule a local notification for `trigger`, an instant on the device's
 * clock (the OS fires by it).
 *
 * A wall-clock (`DATE`) trigger at that instant, since the caller already
 * has one (`fireAtMs`), rather than a delay worked out from it.
 *
 * The trigger type does not decide exactness. On Android either type
 * becomes one RTC alarm, and expo-notifications makes it exact
 * (`setExactAndAllowWhileIdle`, which fires on time in Doze) only while the
 * app holds `SCHEDULE_EXACT_ALARM` (declared in app.config.js). Without the
 * permission, which is denied by default for new installs on Android 14+,
 * the alarm is inexact (`setAndAllowWhileIdle`) and Android may defer it,
 * by longer in Doze. See `lib/exact-alarms.ts`.
 */
export async function scheduleNotification(
  title: string,
  body: string,
  trigger: Date,
  identifier?: string,
  session?: SessionNotificationData,
  extraData?: Record<string, unknown>,
): Promise<string | undefined> {
  const fireAtMs = trigger.getTime();
  if (!Number.isFinite(fireAtMs) || fireAtMs <= Date.now()) {
    devLog('scheduleNotification: trigger time is in the past or invalid. Not scheduling.', fireAtMs);
    return undefined;
  }

  await ensureReminderChannel();

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
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAtMs,
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
