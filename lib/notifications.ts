import { supabase } from './supabase';
import { useUser } from '@clerk/clerk-expo';
import { Alert } from 'react-native';
import { Clerk } from '@clerk/clerk-expo';
import { tokenCache } from '@clerk/clerk-expo/token-cache';

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
  preferences: Partial<Omit<NotificationPreferences, 'id' | 'user_id' | 'created_at' | 'updated_at'>>,
  clerkJwt?: string | null
): Promise<NotificationPreferences | null> {
  Alert.alert('Debug', 'Entering updateNotificationPreferences.');

  try {
    const { data, error } = await supabase
      .from('notification_preferences')
      .upsert({
        user_id: userId,
        ...preferences
      })
      .select()
      .single();

    if (error) {
      Alert.alert('Error', `Supabase upsert error: ${error.message} (Code: ${error.code})`);
      console.error('Error updating notification preferences:', error);
      if (error.code === '42501') {
        Alert.alert('Error Details', 'RLS policy likely denied the request.');
      }
      return null;
    }
    
    Alert.alert('Success', 'updateNotificationPreferences query executed successfully.');
    return data;
  } catch (e: any) {
    Alert.alert('Error', `Exception in updateNotificationPreferences: ${e.message}`);
    return null;
  }
}

export async function updateExpoPushToken(userId: string, token: string): Promise<NotificationPreferences | null> {
  Alert.alert('Debug', 'Entering updateExpoPushToken');

  let clerkToken: string | null = null;
  try {
    clerkToken = await Clerk.session?.getToken({ template: 'supabase' });
    Alert.alert('Debug', `Clerk.session.getToken result: ${clerkToken ? 'Yes (obtained)' : 'No/Null'}`);
  } catch (clerkError: any) {
    Alert.alert('Error', `Failed to get Clerk token: ${clerkError.message}`);
  }

  let cachedToken: string | null | undefined = undefined;
  try {
    if (tokenCache) {
      Alert.alert('Debug', 'tokenCache object exists. Attempting tokenCache.getToken...');
      const tokenCacheKey = `__clerk_client_jwt_supabase`;
      cachedToken = await tokenCache.getToken(tokenCacheKey);
      Alert.alert('Debug', `tokenCache.getToken result for key ${tokenCacheKey}: ${cachedToken ? 'Yes (obtained)' : 'No/Null/Undefined'}`);
    } else {
      Alert.alert('Error', 'tokenCache object is undefined!');
    }
  } catch (cacheError: any) {
    Alert.alert('Error', `Error reading from tokenCache: ${cacheError.message}`);
  }
  
  Alert.alert('Debug', 'Calling updateNotificationPreferences...');
  return updateNotificationPreferences(userId, { expo_push_token: token }, clerkToken);
}

export async function toggleNotifications(userId: string, enabled: boolean): Promise<NotificationPreferences | null> {
  const clerkToken = await Clerk.session?.getToken({ template: 'supabase' }).catch(() => null);
  return updateNotificationPreferences(userId, { notification_enabled: enabled }, clerkToken);
}

export async function updateNotificationTimeBefore(userId: string, minutes: number): Promise<NotificationPreferences | null> {
  const clerkToken = await Clerk.session?.getToken({ template: 'supabase' }).catch(() => null);
  return updateNotificationPreferences(userId, { notification_time_before: minutes }, clerkToken);
} 