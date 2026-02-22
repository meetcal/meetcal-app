import { convex } from './convex';
import { api } from '@/convex/_generated/api';

export interface NotificationPreferences {
  userId: string;
  notificationEnabled: boolean;
  expoPushToken: string | null;
}

export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences | null> {
  try {
    const prefs = await convex.query(api.notificationPreferences.getByUser, { userId });
    if (!prefs) return null;
    return {
      userId: prefs.userId,
      notificationEnabled: prefs.notificationEnabled ?? true,
      expoPushToken: prefs.expoPushToken ?? null,
    };
  } catch (e) {
    console.error('Error fetching notification preferences:', e);
    return null;
  }
}

export async function updateExpoPushToken(userId: string, token: string): Promise<NotificationPreferences | null> {
  try {
    await convex.mutation(api.notificationPreferences.upsert, {
      userId,
      expoPushToken: token,
    });
    return { userId, notificationEnabled: true, expoPushToken: token };
  } catch (e) {
    console.error('Failed to save push token:', e);
    return null;
  }
}

export async function toggleNotifications(userId: string, enabled: boolean): Promise<NotificationPreferences | null> {
  try {
    await convex.mutation(api.notificationPreferences.upsert, {
      userId,
      notificationEnabled: enabled,
    });
    return { userId, notificationEnabled: enabled, expoPushToken: null };
  } catch (e) {
    console.error('Error toggling notifications:', e);
    return null;
  }
}

export async function updateNotificationTimeBefore(_userId: string, _minutes: number): Promise<NotificationPreferences | null> {
  // notification_time_before is not in the Convex schema — no-op
  return null;
}