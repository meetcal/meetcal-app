import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import { addMinutes, isBefore } from 'date-fns';
import AsyncStorage from '@react-native-async-storage/async-storage';

const NOTIFICATION_ENABLED_KEY = '@notification_enabled';

// Base delay for exponential backoff (in milliseconds)
const BASE_RETRY_DELAY = 1000;

/**
 * Retry an async operation with exponential backoff
 */
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      const delay = BASE_RETRY_DELAY * Math.pow(2, i);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

/**
 * Schedule a single notification with error handling and retries
 */
async function scheduleNotificationWithRetry(
  content: Notifications.NotificationContentInput,
  trigger: any
): Promise<string> {
  return retryWithBackoff(async () => {
    try {
      const notificationId = await Notifications.scheduleNotificationAsync({
        content,
        trigger
      });
      return notificationId;
    } catch (error) {
      console.error('Error scheduling notification:', error);
      throw error;
    }
  });
}

/**
 * Schedule notifications for all upcoming sessions
 */
export async function scheduleSessionNotifications(): Promise<void> {
  try {
    // Check if notifications are enabled
    const notificationsEnabled = await AsyncStorage.getItem(NOTIFICATION_ENABLED_KEY);
    if (notificationsEnabled !== 'true') {
      return;
    }

    // Cancel any existing notifications before scheduling new ones
    await retryWithBackoff(async () => {
      await Notifications.cancelAllScheduledNotificationsAsync();
    });
  } catch (error) {
    console.error('Error scheduling notifications:', error);
    throw error;
  }
}

/**
 * Get all scheduled notifications
 */
export async function getScheduledNotifications(): Promise<Notifications.NotificationRequest[]> {
  return retryWithBackoff(async () => {
    return await Notifications.getAllScheduledNotificationsAsync();
  });
} 