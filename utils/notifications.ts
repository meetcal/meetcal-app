import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { updateExpoPushToken } from '../lib/notifications'; // Import the function

// Configure notification handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotificationsAsync(userId: string | null | undefined) {
  let token;
  // Avoid noisy errors on Android dev builds without FCM setup.
  if (__DEV__ && Platform.OS === 'android') {
    console.log('Skipping push token registration on Android dev build.');
    return;
  }

  if (Platform.OS === 'android') {
    // No alert needed here, just channel setup
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
      console.log('Failed to get push token permission! Status:', finalStatus);
      return;
    }
    
    try {
      token = (await Notifications.getExpoPushTokenAsync({
        projectId: 'a0017b93-a31e-42b1-b36a-11cb5eedf11f', // Your Expo project ID
      })).data;
    } catch (e: any) {
        console.error('Failed to get Expo token:', e);
        return; // Exit if token fetch fails
    }

    // If we got a token and a userId, save it to Supabase
    if (token && userId) {
      try {
        await updateExpoPushToken(userId, token);
        console.log('updateExpoPushToken called successfully for user:', userId);
      } catch (error: any) {
        console.error('Failed to save token via updateExpoPushToken:', error);
      }
    } else {
      console.warn('Token or UserID missing, cannot save to Supabase. Token:', !!token, 'UserID:', !!userId);
    }
  } else {
    console.log('Must use physical device for Push Notifications');
  }

  return token;
}

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
