import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function scheduleNotification(title: string, body: string, trigger: Date, identifier?: string) {
  // Calculate seconds (ensuring it's at least 0 or 1, depending on Expo requirements)
  const seconds = Math.max(0, Math.floor((trigger.getTime() - Date.now()) / 1000)); 
  
  // Add a small check if seconds is zero, maybe Expo needs > 0?
  if (seconds <= 0) {
      console.log(`scheduleNotification: Calculated trigger time is in the past or now (${seconds}s). Not scheduling.`);
      return; // Don't schedule if it's already passed
  }

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: true, // Keep sound true
      priority: Notifications.AndroidNotificationPriority.HIGH, // Keep priority
      data: { identifier }, // Pass identifier in data if needed, or use request identifier if available
    },
    // @ts-ignore - Expo accepts this trigger format but TypeScript types are incorrect
    trigger: {
      type: 'timeInterval',
      seconds: seconds, 
      repeats: false, 
    },
    identifier, // Use the identifier directly if supported at the top level
  });
}

export async function cancelNotification(identifier: string) {
  try {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  } catch (error) {
    console.error(`cancelNotification: Error cancelling notification with identifier ${identifier}:`, error);
    // Decide if you need to re-throw or handle differently
  }
}

export async function cancelAllNotifications() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function getScheduledNotifications() {
  return await Notifications.getAllScheduledNotificationsAsync();
} 
