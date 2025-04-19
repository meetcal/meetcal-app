import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform, Alert } from 'react-native';
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
  Alert.alert('Debug', 'Entering registerForPushNotificationsAsync. UserID provided: ' + (userId ? 'Yes' : 'No')); // Alert 1
  let token;

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
    Alert.alert('Debug', 'Device.isDevice = true'); // Alert 2
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    Alert.alert('Debug', `Existing permission status: ${existingStatus}`); // Alert 3
    
    if (existingStatus !== 'granted') {
      Alert.alert('Debug', 'Requesting notification permissions...'); // Alert 4
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
      Alert.alert('Debug', `Requested permission status: ${finalStatus}`); // Alert 5
    }
    
    if (finalStatus !== 'granted') {
      Alert.alert('Error', 'Failed to get push token permission! Status: ' + finalStatus); // Alert 6
      return;
    }
    
    try {
      Alert.alert('Debug', 'Attempting to get Expo push token...'); // Alert 7
      token = (await Notifications.getExpoPushTokenAsync({
        projectId: 'a0017b93-a31e-42b1-b36a-11cb5eedf11f', // Your Expo project ID
      })).data;
      Alert.alert('Debug', 'Got token: ' + (token ? 'Yes (hidden)' : 'No')); // Alert 8 (Don't show full token)
    } catch (e: any) {
        Alert.alert('Error', 'Failed to get Expo token: ' + e.message); // Alert 9
        return; // Exit if token fetch fails
    }

    // If we got a token and a userId, save it to Supabase
    if (token && userId) {
      Alert.alert('Debug', 'Token and UserID present. Calling updateExpoPushToken...'); // Alert 10
      try {
        await updateExpoPushToken(userId, token);
        Alert.alert('Success', 'updateExpoPushToken called. Check Supabase.'); // Alert 11
      } catch (error: any) {
        Alert.alert('Error', 'Failed to save token via updateExpoPushToken: ' + error.message); // Alert 12
      }
    } else {
      Alert.alert('Debug', 'Token or UserID missing. Token: ' + (token ? 'Yes' : 'No') + ', UserID: ' + (userId ? 'Yes' : 'No')); // Alert 13
    }
  } else {
    Alert.alert('Warning', 'Must use physical device for Push Notifications'); // Alert 14
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