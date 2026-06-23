import * as Notifications from 'expo-notifications';

import { createSessionDetailsDeepLink } from '@/utils/deepLinks';

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
): Promise<string | undefined> {
  const seconds = Math.max(0, Math.floor((trigger.getTime() - Date.now()) / 1000));

  if (seconds <= 0) {
    console.log(`scheduleNotification: Calculated trigger time is in the past or now (${seconds}s). Not scheduling.`);
    return undefined;
  }

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: true,
      priority: Notifications.AndroidNotificationPriority.HIGH,
      data: {
        identifier,
        url: session ? createSessionDetailsDeepLink(session) : undefined,
      },
    },
    // @ts-ignore - Expo accepts this trigger format but TypeScript types are incorrect
    trigger: {
      type: 'timeInterval',
      seconds: seconds,
      repeats: false,
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

