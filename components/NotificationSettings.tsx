import React, { useEffect, useState } from 'react';
import { View, Switch, StyleSheet, Alert, Platform, Linking } from 'react-native';
import { ThemedText } from './ThemedText';
import * as Notifications from 'expo-notifications';
import { useUser } from '@clerk/clerk-expo';
import { getNotificationPreferences, toggleNotifications, updateNotificationTimeBefore } from '@/lib/notifications';
import { scheduleSessionNotifications } from '@/utils/notificationScheduler';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface NotificationSettingsProps {
  colors: {
    text: string;
    secondaryText: string;
    border: string;
    card: string;
    pressed: string;
  };
}

export function NotificationSettings({ colors }: NotificationSettingsProps) {
  const { user } = useUser();
  const [isEnabled, setIsEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadNotificationSettings();
  }, [user?.id]);

  const loadNotificationSettings = async () => {
    if (!user?.id) return;

    try {
      const prefs = await getNotificationPreferences(user.id);
      setIsEnabled(prefs?.notification_enabled ?? false);
    } catch (error) {
      console.error('Error loading notification settings:', error);
      setIsEnabled(false);
    } finally {
      setIsLoading(false);
    }
  };

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    return finalStatus === 'granted';
  };

  const handleToggle = async () => {
    if (!user?.id) return;

    const newEnabledState = !isEnabled;

    try {
      if (newEnabledState) {
        // Check if we've shown the initial prompt
        const hasCheckedNotifications = await AsyncStorage.getItem('hasCheckedNotifications');
        
        // If we haven't shown the prompt yet, show it and save the state
        if (!hasCheckedNotifications) {
          const permissionGranted = await requestPermissions();
          await AsyncStorage.setItem('hasCheckedNotifications', 'true');
          if (!permissionGranted) return;
        } else {
          // We've shown the prompt before, but let's check permissions again
          const { status: existingStatus } = await Notifications.getPermissionsAsync();
          if (existingStatus !== 'granted') {
            Alert.alert(
              'Permission Required',
              'Please enable notifications in your device settings to receive session reminders.',
              [
                { text: 'Cancel', style: 'cancel' },
                { 
                  text: 'Open Settings', 
                  onPress: () => Linking.openSettings()
                }
              ]
            );
            return;
          }
        }

        // Set up Android channel if needed
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#FF231F7C',
          });
        }
      }

      // Update the UI state first for better UX
      setIsEnabled(newEnabledState);

      // Update the database
      const result = await toggleNotifications(user.id, newEnabledState);
      
      if (!result) {
        // If the database update failed, revert the UI
        setIsEnabled(!newEnabledState);
        throw new Error('Failed to update notification preferences');
      }

      if (newEnabledState) {
        // Schedule notifications for existing sessions when enabling
        await scheduleSessionNotifications(user.id);
      }
    } catch (error) {
      console.error('Error toggling notifications:', error);
      Alert.alert('Error', 'Failed to update notification settings. Please try again.');
      // UI state has already been reverted if needed
    }
  };

  if (isLoading) {
    return null;
  }

  return (
    <View style={[styles.container, { borderBottomColor: colors.border }]}>
      <View style={styles.row}>
        <View>
          <ThemedText style={[styles.label, { color: colors.text }]}>
            Session Reminders
          </ThemedText>
          <ThemedText style={[styles.description, { color: colors.secondaryText }]}>
            Get notified 1 hour before your sessions
          </ThemedText>
        </View>
        <Switch
          trackColor={{ false: '#767577', true: '#81b0ff' }}
          thumbColor={isEnabled ? '#007AFF' : '#f4f3f4'}
          ios_backgroundColor="#3e3e3e"
          onValueChange={handleToggle}
          value={isEnabled}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 17,
    fontWeight: '400',
    marginBottom: 4,
  },
  description: {
    fontSize: 14,
  },
}); 