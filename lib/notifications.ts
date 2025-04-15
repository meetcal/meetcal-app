import { supabase } from './supabase';
import { useUser } from '@clerk/clerk-expo';

export interface NotificationPreferences {
  id: string;
  user_id: string;
  notification_enabled: boolean;
  notification_time_before: number;
  expo_push_token: string | null;
  created_at: string;
  updated_at: string;
}

export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences | null> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) {
    console.error('Error fetching notification preferences:', error);
    return null;
  }

  return data;
}

export async function updateNotificationPreferences(
  userId: string,
  preferences: Partial<Omit<NotificationPreferences, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
): Promise<NotificationPreferences | null> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .upsert({
      user_id: userId,
      ...preferences
    })
    .select()
    .single();

  if (error) {
    console.error('Error updating notification preferences:', error);
    return null;
  }

  return data;
}

export async function updateExpoPushToken(userId: string, token: string): Promise<NotificationPreferences | null> {
  return updateNotificationPreferences(userId, { expo_push_token: token });
}

export async function toggleNotifications(userId: string, enabled: boolean): Promise<NotificationPreferences | null> {
  return updateNotificationPreferences(userId, { notification_enabled: enabled });
}

export async function updateNotificationTimeBefore(userId: string, minutes: number): Promise<NotificationPreferences | null> {
  return updateNotificationPreferences(userId, { notification_time_before: minutes });
} 