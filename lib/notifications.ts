import { convex } from './convex';
import { api } from '@/convex/_generated/api';

export interface NotificationPreferences {
  userId: string;
  notificationEnabled: boolean;
}

export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences | null> {
  try {
    const prefs = await convex.query(api.notificationPreferences.getByUser, { userId });
    if (!prefs) return null;
    return {
      userId: prefs.userId,
      notificationEnabled: prefs.notificationEnabled ?? true,
    };
  } catch (e) {
    console.error('Error fetching notification preferences:', e);
    return null;
  }
}

export async function toggleNotifications(userId: string, enabled: boolean): Promise<NotificationPreferences | null> {
  try {
    await convex.mutation(api.notificationPreferences.upsert, {
      userId,
      notificationEnabled: enabled,
    });
    return { userId, notificationEnabled: enabled };
  } catch (e) {
    console.error('Error toggling notifications:', e);
    return null;
  }
}

export async function updateNotificationTimeBefore(_userId: string, _minutes: number): Promise<NotificationPreferences | null> {
  return null;
}
