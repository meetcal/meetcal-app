import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { StyleSheet, View, Pressable, Platform, Alert, ScrollView } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Calendar from 'expo-calendar';
import { useState, useEffect, useMemo } from 'react';
import { Linking } from 'react-native';
import { format } from 'date-fns';
import { useTheme } from '@/contexts/ThemeContext';
import { getPlatformColors } from '@/data/schedule';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useSavedSessions } from '@/contexts/SavedSessionsContext';
import { getFullLocation } from '@/config/venue';
import { schedule } from '@/data/schedule';
import { liftingResults } from '@/data/athletes';

type SessionPlatform = 'A' | 'B' | 'C' | 'D';

// Type for just the athlete data we need
type SessionAthlete = {
  name: string;
  club: string;
  entryTotal: number;
  bestSnatch: number;
  bestCJ: number;
  bestTotal: number;
};

function getSessionAthletes(sessionNumber: number, platform: string) {
  // Get session data first
  const sessionDay = schedule.find(day => 
    day.sessions.some(s => s.number === sessionNumber)
  );
  
  const session = sessionDay?.sessions.find(s => 
    s.number === sessionNumber
  );

  // Get athletes but only take the fields we need
  return liftingResults
    .filter(athlete => 
      athlete.session?.number === sessionNumber && 
      athlete.session?.platform === platform
    )
    .sort((a, b) => b.entryTotal - a.entryTotal)
    .reduce((platforms, athlete) => {
      const platform = athlete.session!.platform;
      if (!platforms[platform]) {
        platforms[platform] = [];
      }
      
      // Only include the specific fields we need, no weightClass
      platforms[platform].push({
        name: athlete.name,
        club: athlete.club,
        entryTotal: athlete.entryTotal,
        bestSnatch: athlete.bestSnatch,
        bestCJ: athlete.bestCJ,
        bestTotal: athlete.bestTotal
      });
      
      return platforms;
    }, {} as Record<string, SessionAthlete[]>);
}

function SessionAthletes({ sessionNumber, platform, sessionWeightClass }: { 
  sessionNumber: number;
  platform: string;
  sessionWeightClass: string;
}) {
  const { currentTheme } = useTheme();
  const athletes = getSessionAthletes(sessionNumber, platform);
  
  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
  };
  
  return (
    <View style={[styles.card, { backgroundColor: colors.card, marginTop: 16 }]}>
      <View style={[styles.section, { borderBottomColor: colors.border }]}>
        <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>
          Session Athletes
        </ThemedText>
      </View>
      
      {Object.entries(athletes).map(([platform, platformAthletes]) => (
        <View key={platform}>
          {platformAthletes.map((athlete, index) => (
            <View 
              key={athlete.name} 
              style={[
                styles.athleteRow,
                index !== platformAthletes.length - 1 && { 
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: colors.border 
                }
              ]}
            >
              <View style={styles.athleteHeader}>
                <ThemedText style={styles.athleteName}>{athlete.name}</ThemedText>
                <ThemedText style={{ color: colors.secondaryText }}>{athlete.club}</ThemedText>
              </View>
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <ThemedText style={[styles.statLabel, { color: colors.secondaryText }]}>Entry Total</ThemedText>
                  <ThemedText style={styles.statValue}>{athlete.entryTotal}kg</ThemedText>
                </View>
                <View style={styles.statItem}>
                  <ThemedText style={[styles.statLabel, { color: colors.secondaryText }]}>Best Snatch</ThemedText>
                  <ThemedText style={styles.statValue}>{athlete.bestSnatch}kg</ThemedText>
                </View>
                <View style={styles.statItem}>
                  <ThemedText style={[styles.statLabel, { color: colors.secondaryText }]}>Best CJ</ThemedText>
                  <ThemedText style={styles.statValue}>{athlete.bestCJ}kg</ThemedText>
                </View>
                <View style={styles.statItem}>
                  <ThemedText style={[styles.statLabel, { color: colors.secondaryText }]}>Best Total</ThemedText>
                  <ThemedText style={styles.statValue}>{athlete.bestTotal}kg</ThemedText>
                </View>
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function PlatformBadge({ platform }: { platform: SessionPlatform }) {
  const platformColors = getPlatformColors();
  const backgroundColor = platformColors[platform];
  
  return (
    <View style={[styles.platformBadge, { backgroundColor }]}>
      <ThemedText style={styles.platformText}>{platform}</ThemedText>
    </View>
  );
}

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
    date: string;
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

  // Get the correct weight class from schedule.ts
  const sessionWeightClass = useMemo(() => {
    const sessionDay = schedule.find(day => 
      day.sessions.some(s => s.number === parseInt(params.sessionNumber))
    );
    
    const session = sessionDay?.sessions.find(s => 
      s.number === parseInt(params.sessionNumber)
    );

    const platformData = session?.platforms.find(p => 
      p.platform === params.platform
    );

    return platformData?.weightClass;
  }, [params.sessionNumber, params.platform]);

  const showSaveAlert = (action: 'save' | 'remove') => {
    const title = action === 'save' ? 'Session Saved' : 'Session Unsaved';
    const message = action === 'save'
      ? `Session ${params.sessionNumber} - ${params.platform} - ${sessionWeightClass} has been saved to your list`
      : `Session ${params.sessionNumber} - ${params.platform} - ${sessionWeightClass} has been unsaved from your list`;

    Alert.alert(
      title,
      message,
      [{ text: 'OK' }],
      { userInterfaceStyle: 'light' }
    );
  };

  const handleSavePress = () => {
    if (isSaved) {
      removeSession(params.id);
      showSaveAlert('remove');
    } else {
      saveSession({
        id: params.id,
        sessionNumber: params.sessionNumber,
        platform: params.platform,
        weightClass: sessionWeightClass || params.weightClass, // Use correct weight class
        startTime: params.startTime,
        weighInTime: params.weighInTime,
        date: params.date,
      });
      showSaveAlert('save');
    }
    Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Success
    );
  };

  const showSuccessAlert = () => {
    Alert.alert(
      'Added to Calendar',
      `Session ${params.sessionNumber} - ${params.platform} - ${sessionWeightClass} has been added to your calendar`,
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
      setHasCalendarPermission(true);
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
      
      // Create Date object in UTC, adding 5 hours for EST
      return new Date(Date.UTC(year, month - 1, day, adjustedHours + 5, minutes));
    };

    // Find the session by session number and platform instead of ID
    const sessionDay = schedule.find(day => 
      day.sessions.some(session => 
        session.number === parseInt(params.sessionNumber) &&
        session.platforms.some(platform => platform.platform === params.platform)
      )
    );

    if (!sessionDay) {
      console.error('Session day not found:', {
        sessionNumber: params.sessionNumber,
        platform: params.platform,
        date: params.date
      });
      Alert.alert(
        'Error',
        'Could not find session details. Please try again.',
        [{ text: 'OK' }],
        { userInterfaceStyle: 'light' }
      );
      return;
    }

    const startDate = parseTimeString(params.startTime, sessionDay.fullDate);
    const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);

    const eventDetails = {
      title: `Session ${params.sessionNumber} - Platform ${params.platform}`,
      location: getFullLocation(),
      notes: `Weight Class: ${sessionWeightClass}\nWeigh-in Time: ${params.weighInTime}`,
      startDate: startDate.getTime(),
      endDate: endDate.getTime(),
      timeZone: 'America/New_York',
      alarms: [{
        relativeOffset: -60,
      }],
    };

    try {
      let calendarId;

      if (Platform.OS === 'ios') {
        const calendar = await Calendar.getDefaultCalendarAsync();
        calendarId = calendar.id;
      } else {
        // Android: Get available calendars and find a suitable one
        const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
        const primaryCalendar = calendars.find(cal => 
          cal.accessLevel === Calendar.CalendarAccessLevel.OWNER && 
          cal.allowsModifications
        );

        if (!primaryCalendar) {
          Alert.alert(
            'Calendar Error',
            'No suitable calendar found. Please make sure you have at least one calendar set up on your device.',
            [{ text: 'OK' }],
            { userInterfaceStyle: 'light' }
          );
          return;
        }

        calendarId = primaryCalendar.id;
      }

      await Calendar.createEventAsync(calendarId, eventDetails);
      showSuccessAlert();
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success
      );
    } catch (error) {
      console.error('Error creating calendar event:', error);
      
      // More specific error message
      const errorMessage = Platform.select({
        ios: 'Could not add event to calendar. Please try again.',
        android: 'Could not add event to calendar. Please make sure you have a calendar app installed and try again.',
        default: 'Could not add event to calendar. Please try again.'
      });

      Alert.alert(
        'Error',
        errorMessage,
        [{ text: 'OK' }],
        { userInterfaceStyle: 'light' }
      );
    }
  };

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: `Session ${params.sessionNumber}`,
          headerBackTitle: 'Back',
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          animation: 'slide_from_right',
          headerStyle: {
            backgroundColor: colors.background,
          },
          headerShadowVisible: false,
        }}
      />
      
      <ScrollView 
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: 16 } // Add consistent padding at top
        ]}
      >
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
                <PlatformBadge platform={params.platform as SessionPlatform} />
              </View>
            </View>

            <View style={[styles.section, { borderBottomColor: colors.border }]}>
              <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
                Weight Class
              </ThemedText>
              <ThemedText style={[styles.value, { color: colors.text }]}>
                {sessionWeightClass || params.weightClass}
              </ThemedText>
            </View>

            <View style={[styles.section, { borderBottomColor: colors.border }]}>
              <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
                Weigh-in Time
              </ThemedText>
              <ThemedText style={[styles.value, { color: colors.text }]}>
                {params.weighInTime} EST
              </ThemedText>
            </View>

            <View style={[styles.section, styles.lastSection]}>
              <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
                Start Time
              </ThemedText>
              <ThemedText style={[styles.value, { color: colors.text }]}>
                {params.startTime} EST
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
          
          <SessionAthletes 
            sessionNumber={parseInt(params.sessionNumber)} 
            platform={params.platform}
            sessionWeightClass={sessionWeightClass || params.weightClass}
          />
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 32,
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
  platformBadge: {
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
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  athleteRow: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 4,
  },
  athleteHeader: {
    gap: 2,
  },
  athleteName: {
    fontSize: 17,
    fontWeight: '500',
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: 8,
    gap: 16,
  },
  statItem: {
    flex: 1,
  },
  statLabel: {
    fontSize: 13,
    marginBottom: 2,
  },
  statValue: {
    fontSize: 15,
    fontWeight: '500',
  },
  weightClass: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },
}); 