import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import { supabase } from '@/lib/supabase';
import { getNotificationPreferences } from '@/lib/notifications';
import { addMinutes, isBefore, parseISO, isAfter, isSameHour } from 'date-fns';

interface Session {
  id: string;
  start_time: string;
  session_name: string;
  platform: string;
  group: string;
  is_cancelled?: boolean;
}

interface SavedSession {
  id: string;
  session: Session;
}

interface DatabaseSession {
  id: string;
  start_time: string;
  session_name: string;
  platform: string;
  group: string;
  is_cancelled?: boolean;
}

interface DatabaseSavedSession {
  id: string;
  session: DatabaseSession;
}

interface ScheduledNotification {
  id: string;
  sessionId: string;
  scheduledFor: Date;
}

// Use Expo's type directly
type NotificationTrigger = Notifications.TimeIntervalTriggerInput;

// Maximum number of retry attempts for failed operations
const MAX_RETRIES = 3;
// Base delay for exponential backoff (in milliseconds)
const BASE_RETRY_DELAY = 1000;

/**
 * Helper function to group sessions by hour
 */
function groupSessionsByHour(sessions: DatabaseSavedSession[]): Map<string, DatabaseSavedSession[]> {
  const grouped = new Map<string, DatabaseSavedSession[]>();
  
  sessions.forEach(savedSession => {
    const startTime = parseISO(savedSession.session.start_time);
    const hourKey = startTime.toISOString().slice(0, 13); // YYYY-MM-DDTHH
    
    const existing = grouped.get(hourKey) || [];
    existing.push(savedSession);
    grouped.set(hourKey, existing);
  });
  
  return grouped;
}

/**
 * Create a combined notification message for multiple sessions
 */
function createMultiSessionNotification(sessions: DatabaseSession[], minutesBefore: number): string {
  if (sessions.length === 1) {
    const session = sessions[0];
    return `Your session "${session.session_name}" on platform ${session.platform} (Group ${session.group}) starts in ${minutesBefore} minutes`;
  }

  const platforms = [...new Set(sessions.map(s => s.platform))].join(', ');
  return `You have ${sessions.length} sessions starting in ${minutesBefore} minutes on platform(s) ${platforms}`;
}

/**
 * Retry function with exponential backoff
 */
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  retryCount = 0
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (retryCount >= MAX_RETRIES) {
      throw error;
    }
    
    // Calculate delay with exponential backoff
    const delay = BASE_RETRY_DELAY * Math.pow(2, retryCount);
    console.log(`Retry attempt ${retryCount + 1} after ${delay}ms`);
    
    await new Promise(resolve => setTimeout(resolve, delay));
    return retryWithBackoff(operation, retryCount + 1);
  }
}

/**
 * Schedule a single notification with error handling and retries
 */
async function scheduleNotificationWithRetry(
  content: Notifications.NotificationContentInput,
  trigger: NotificationTrigger
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
 * Schedule notifications for all upcoming sessions for a user
 */
export async function scheduleSessionNotifications(userId: string): Promise<void> {
  try {
    // Get user's notification preferences
    const preferences = await retryWithBackoff(async () => {
      const prefs = await getNotificationPreferences(userId);
      if (!prefs || !prefs.notification_enabled) {
        console.log('Notifications are disabled for user:', userId);
        return null;
      }
      return prefs;
    });

    if (!preferences) return;

    // Cancel any existing notifications before scheduling new ones
    await retryWithBackoff(async () => {
      await Notifications.cancelAllScheduledNotificationsAsync();
    });

    // Get all saved sessions for the user
    const savedSessions = await retryWithBackoff(async () => {
      const { data, error } = await supabase
        .from('saved_sessions')
        .select(`
          id,
          session:sessions (
            id,
            start_time,
            session_name,
            platform,
            group,
            is_cancelled
          )
        `)
        .eq('user_id', userId)
        .returns<DatabaseSavedSession[]>();

      if (error) throw error;
      return data || [];
    });

    const now = new Date();
    const scheduledNotifications: ScheduledNotification[] = [];

    // Filter out cancelled sessions and group remaining by hour
    const activeSessions = savedSessions.filter(ss => !ss.session.is_cancelled);
    const groupedSessions = groupSessionsByHour(activeSessions);

    // Schedule notifications for each time slot
    for (const [hourKey, sessions] of groupedSessions) {
      const firstSession = sessions[0].session;
      const sessionStartTime = parseISO(firstSession.start_time);
      const notificationTime = addMinutes(sessionStartTime, -preferences.notification_time_before);

      // Only schedule notifications for future sessions
      if (isBefore(notificationTime, now)) {
        continue;
      }

      try {
        // Create notification content based on number of sessions
        const notificationBody = createMultiSessionNotification(
          sessions.map(s => s.session),
          preferences.notification_time_before
        );

        const trigger: NotificationTrigger = {
          type: SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: Math.floor((notificationTime.getTime() - now.getTime()) / 1000),
          repeats: false
        };

        const notificationId = await scheduleNotificationWithRetry(
          {
            title: sessions.length === 1 ? 'Upcoming Session' : 'Multiple Sessions Starting Soon',
            body: notificationBody,
            data: {
              sessionIds: sessions.map(s => s.session.id),
              startTime: sessionStartTime.toISOString(),
            },
          },
          trigger
        );

        scheduledNotifications.push({
          id: notificationId,
          sessionId: sessions.map(s => s.session.id).join(','),
          scheduledFor: notificationTime,
        });
      } catch (error) {
        console.error(
          'Failed to schedule notification after retries for sessions:',
          sessions.map(s => s.session.id),
          error
        );
      }
    }

    console.log('Successfully scheduled notifications:', scheduledNotifications);
  } catch (error) {
    console.error('Fatal error in scheduleSessionNotifications:', error);
    throw error;
  }
}

/**
 * Reschedule notifications when sessions are updated
 */
export async function handleSessionUpdate(userId: string, sessionId: string): Promise<void> {
  try {
    // Check if the session was cancelled
    const session = await retryWithBackoff(async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('is_cancelled, start_time')
        .eq('id', sessionId)
        .single();

      if (error) throw error;
      return data;
    });

    // If the session was cancelled or updated, reschedule all notifications
    // This ensures we handle both cancellations and time changes
    await scheduleSessionNotifications(userId);
  } catch (error) {
    console.error('Error handling session update:', error);
    throw error;
  }
}

/**
 * Cancel all scheduled notifications for a user
 */
export async function cancelAllSessionNotifications(): Promise<void> {
  await retryWithBackoff(async () => {
    await Notifications.cancelAllScheduledNotificationsAsync();
  });
}

/**
 * Get all scheduled notifications
 */
export async function getScheduledNotifications(): Promise<Notifications.NotificationRequest[]> {
  return retryWithBackoff(async () => {
    return await Notifications.getAllScheduledNotificationsAsync();
  });
} 