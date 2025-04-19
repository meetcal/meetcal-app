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
  }),
});

export async function registerForPushNotificationsAsync(userId: string | null | undefined) {
  let token;

  if (Platform.OS === 'android') {
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
      console.log('Failed to get push token for push notification!');
      return;
    }
    
    token = (await Notifications.getExpoPushTokenAsync({
      projectId: 'a0017b93-a31e-42b1-b36a-11cb5eedf11f', // Your Expo project ID
    })).data;

    // If we got a token and a userId, save it to Supabase
    if (token && userId) {
      try {
        await updateExpoPushToken(userId, token);
        console.log('Expo Push Token saved to Supabase for user:', userId);
      } catch (error) {
        console.error('Failed to save Expo Push Token to Supabase:', error);
      }
    }
  } else {
    console.log('Must use physical device for Push Notifications');
  }

  return token;
}

export async function scheduleNotification(title: string, body: string, trigger: Date) {
  // Calculate seconds (ensuring it's at least 0 or 1, depending on Expo requirements)
  const seconds = Math.max(0, Math.floor((trigger.getTime() - Date.now()) / 1000)); 
  
  // Add a small check if seconds is zero, maybe Expo needs > 0?
  if (seconds <= 0) {
      console.log(`scheduleNotification: Calculated trigger time is in the past or now (${seconds}s). Not scheduling.`);
      return; // Don't schedule if it's already passed
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: true, // Keep sound true
      priority: Notifications.AndroidNotificationPriority.HIGH, // Keep priority
    },
    trigger: {
      // Revert to the older structure
      type: 'timeInterval', 
      seconds: seconds, 
      repeats: false, 
      // channelId: 'default', // Remove channelId if using timeInterval type
    },
  });
  console.log(`scheduleNotification: Notification scheduled to trigger in ${seconds} seconds.`);
}

export async function cancelAllNotifications() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function getScheduledNotifications() {
  return await Notifications.getAllScheduledNotificationsAsync();
} 