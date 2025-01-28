import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View, Pressable, Platform, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Calendar from 'expo-calendar';
import { useState, useEffect } from 'react';
import { Linking } from 'react-native';
import { format } from 'date-fns';
import { useTheme } from '@/contexts/ThemeContext';
import { getPlatformColors } from '@/data/schedule';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useSavedSessions } from '@/contexts/SavedSessionsContext';
import { getFullLocation } from '@/config/venue';
import { schedule } from '@/data/schedule';

export default function SessionDetailsScreen() {
  const [hasCalendarPermission, setHasCalendarPermission] = useState(false);
  const router = useRouter();
  const { saveSession, removeSession, isSessionSaved } = useSavedSessions();
  const params = useLocalSearchParams<{
    id: string;
    sessionNumber: string;
    platform: string;
    weightClass: string;
    startTime: string;
    weighInTime: string;
  }>();
  const { currentTheme } = useTheme();
  const platformColors = getPlatformColors();

  const isSaved = isSessionSaved(params.id);

  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
  };

  useEffect(() => {
    (async () => {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      setHasCalendarPermission(status === 'granted');
    })();
  }, []);

  const showSaveAlert = (action: 'save' | 'remove') => {
    const title = action === 'save' ? 'Session Saved' : 'Session Unsaved';
    const message = action === 'save'
      ? `Session ${params.sessionNumber} - ${params.platform} - ${params.weightClass} has been saved to your list`
      : `Session ${params.sessionNumber} - ${params.platform} - ${params.weightClass} has been unsaved from your list`;

    Alert.alert(
      title,
      message,
      [{ text: 'OK' }],
      { userInterfaceStyle: 'light' }
    );
  };

  const handleSavePress = async () => {
    try {
      if (isSaved) {
        await removeSession(params.id);
        showSaveAlert('remove');
      } else {
        await saveSession({
          id: params.id,
          sessionNumber: params.sessionNumber,
          platform: params.platform,
          weightClass: params.weightClass,
          startTime: params.startTime,
          weighInTime: params.weighInTime,
        });
        showSaveAlert('save');
      }
      
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success
      );
    } catch (error) {
      console.error('Error saving session:', error);
      Alert.alert(
        'Error',
        'Could not update saved sessions. Please try again.',
        [{ text: 'OK' }],
        { userInterfaceStyle: 'light' }
      );
    }
  };

  const showSuccessAlert = () => {
    Alert.alert(
      'Added to Calendar',
      `Session ${params.sessionNumber} - ${params.platform} - ${params.weightClass} has been added to your calendar`,
      [{ text: 'OK' }],
      { userInterfaceStyle: 'light' }
    );
  };

  const addToCalendar = async () => {
    if (!hasCalendarPermission) {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Calendar Permission Required',
          'Please enable calendar access in your device settings to add events.',
          [{ text: 'OK' }],
          { userInterfaceStyle: 'light' }
        );
        return;
      }
    }

    // Parse time strings (assuming format like "8:00 AM")
    const parseTimeString = (timeStr: string, dateStr: string) => {
      const [time, period] = timeStr.split(' ');
      const [hours, minutes] = time.split(':').map(Number);
      
      let adjustedHours = hours;
      if (period === 'PM' && hours !== 12) {
        adjustedHours += 12;
      } else if (period === 'AM' && hours === 12) {
        adjustedHours = 0;
      }

      const [year, month, day] = dateStr.split('-').map(Number);
      return new Date(year, month - 1, day, adjustedHours, minutes);
    };

    // Find the day schedule for this session
    const sessionDay = schedule.find(day => 
      day.sessions.some(session => 
        session.platforms.some(platform => 
          `${session.id}-${platform.platform}` === params.id
        )
      )
    );

    if (!sessionDay) {
      Alert.alert(
        'Error',
        'Could not find session details',
        [{ text: 'OK' }],
        { userInterfaceStyle: 'light' }
      );
      return;
    }

    const startDate = parseTimeString(params.startTime, sessionDay.fullDate);
    const weighInDate = parseTimeString(params.weighInTime, sessionDay.fullDate);

    const eventDetails = {
      title: `Session ${params.sessionNumber} - Platform ${params.platform}`,
      location: getFullLocation(),
      notes: `Weight Class: ${params.weightClass}\nWeigh-in Time: ${params.weighInTime}`,
      startDate: startDate,
      endDate: new Date(startDate.getTime() + 2 * 60 * 60 * 1000),
      timeZone: 'America/New_York',
      alarms: [{
        relativeOffset: -60,
      }],
    };

    try {
      const defaultCalendar = await Calendar.getDefaultCalendarAsync();
      await Calendar.createEventAsync(defaultCalendar.id, eventDetails);
      showSuccessAlert();
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success
      );
    } catch (error) {
      console.error('Error adding to calendar:', error);
      Alert.alert(
        'Error',
        'Could not add event to calendar. Please try again.',
        [{ text: 'OK' }],
        { userInterfaceStyle: 'light' }
      );
    }
  };

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.content, { backgroundColor: colors.background }]}>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={[styles.section, { borderBottomColor: colors.border }]}>
            <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
              Session
            </ThemedText>
            <ThemedText style={[styles.value, { color: colors.text }]}>
              {params.sessionNumber}
            </ThemedText>
          </View>

          <View style={[styles.section, { borderBottomColor: colors.border }]}>
            <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
              Platform
            </ThemedText>
            <View style={styles.platformRow}>
              <View style={[
                styles.platformIndicator,
                { backgroundColor: platformColors[params.platform as keyof typeof platformColors] }
              ]}>
                <ThemedText style={styles.platformText}>
                  {params.platform}
                </ThemedText>
              </View>
            </View>
          </View>

          <View style={[styles.section, { borderBottomColor: colors.border }]}>
            <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
              Weight Class
            </ThemedText>
            <ThemedText style={[styles.value, { color: colors.text }]}>
              {params.weightClass}
            </ThemedText>
          </View>

          <View style={[styles.section, { borderBottomColor: colors.border }]}>
            <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
              Weigh-in Time
            </ThemedText>
            <ThemedText style={[styles.value, { color: colors.text }]}>
              {params.weighInTime}
            </ThemedText>
          </View>

          <View style={[styles.section, styles.lastSection]}>
            <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
              Start Time
            </ThemedText>
            <ThemedText style={[styles.value, { color: colors.text }]}>
              {params.startTime}
            </ThemedText>
          </View>

          <View style={styles.buttonContainer}>
            <Pressable
              style={({ pressed }) => [
                styles.saveButton,
                pressed && styles.saveButtonPressed
              ]}
              onPress={handleSavePress}
            >
              <ThemedText style={styles.saveButtonText}>
                {isSaved ? 'Unsave Session' : 'Save Session'}
              </ThemedText>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.calendarButton,
                pressed && styles.calendarButtonPressed
              ]}
              onPress={addToCalendar}
            >
              <ThemedText style={styles.calendarButtonText}>
                Add to Calendar
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  card: {
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  section: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lastSection: {
    borderBottomWidth: 0,
  },
  label: {
    fontSize: 15,
    marginBottom: 4,
  },
  value: {
    fontSize: 17,
  },
  platformRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  platformIndicator: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  platformText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  buttonContainer: {
    padding: 16,
    gap: 12,
  },
  saveButton: {
    backgroundColor: '#007AFF',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveButtonPressed: {
    opacity: 0.8,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  calendarButton: {
    backgroundColor: '#34C759', // iOS green
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  calendarButtonPressed: {
    opacity: 0.8,
  },
  calendarButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
}); 