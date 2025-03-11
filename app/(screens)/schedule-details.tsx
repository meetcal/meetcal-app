import React from 'react';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { StyleSheet, View, Pressable, Platform, Alert, ScrollView, ActivityIndicator } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Calendar from 'expo-calendar';
import { useState, useEffect, useMemo } from 'react';
import { Linking } from 'react-native';
import { format } from 'date-fns';
import { useTheme } from '@/contexts/ThemeContext';
import { getPlatformColors, getSessionTimeRange, getPlatformStartTime } from '@/data/schedule';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useSavedSessions } from '@/contexts/SavedSessionsContext';
import { getFullLocation } from '@/config/venue';
import { schedule } from '@/data/schedule';
import { liftingResults } from '@/data/athletes';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { useSelectedMeet } from '@/contexts/SelectedMeetContext';
import { getSchedule } from '@/data/meets/scheduleManager';
import { getAthletesBySession } from '@/data/meets/athletesManager';
import { MeetName } from '@/data/types/meet';

type SessionPlatform = 'Red' | 'White' | 'Blue' | 'Stars' | 'Stripes' | 'Rogue';

// Add interface for Supabase results
interface SupabaseBests {
  snatch_best: number;
  cj_best: number;
  total: number;
}

// Type for just the athlete data we need
type SessionAthlete = {
  name: string;
  age: number;
  club: string;
  entryTotal: number;
};

function getSessionAthletes(meetName: MeetName, sessionNumber: number, platform: string) {
  // Get athletes for this session and platform
  const athletes = getAthletesBySession(meetName, sessionNumber, platform);
  
  // Convert to platform-grouped format
  return {
    [platform]: athletes.map(athlete => ({
      name: athlete.name,
      age: athlete.age,
      club: athlete.club,
      entryTotal: athlete.entryTotal,
    }))
  };
}

async function getAthleteBests(name: string): Promise<SupabaseBests> {
  try {
    const { data, error } = await supabase
      .from('lifting_results')
      .select('snatch_best, cj_best, total')
      .eq('name', name)
      .order('date', { ascending: false })
      .limit(1);

    if (error) {
      console.error('Error fetching athlete bests:', error);
      return { snatch_best: 0, cj_best: 0, total: 0 };
    }

    return data?.[0] || { snatch_best: 0, cj_best: 0, total: 0 };
  } catch (error) {
    console.error('Error in getAthleteBests:', error);
    return { snatch_best: 0, cj_best: 0, total: 0 };
  }
}

function SessionAthletes({ sessionNumber, platform, sessionWeightClass }: { 
  sessionNumber: number;
  platform: string;
  sessionWeightClass: string;
}) {
  const router = useRouter();
  const { currentTheme } = useTheme();
  const { selectedMeet } = useSelectedMeet();
  const [athleteBests, setAthleteBests] = useState<Record<string, SupabaseBests>>({});
  const [loading, setLoading] = useState(true);

  const colors = {
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
  };

  const athletes = useMemo(() => 
    getSessionAthletes(selectedMeet, sessionNumber, platform), 
    [selectedMeet, sessionNumber, platform]
  );

  useEffect(() => {
    const fetchAthleteBests = async () => {
      setLoading(true);
      const bests: Record<string, SupabaseBests> = {};
      
      for (const [_, platformAthletes] of Object.entries(athletes)) {
        for (const athlete of platformAthletes) {
          bests[athlete.name] = await getAthleteBests(athlete.name);
        }
      }
      
      setAthleteBests(bests);
      setLoading(false);
    };

    fetchAthleteBests();
  }, [athletes]);

  const handleAthletePress = (athleteName: string) => {
    router.push({
      pathname: '/athlete-results',
      params: { name: athleteName }
    });
  };

  if (!athletes[platform]?.length) {
    return null;
  }

  return (
    <View style={styles.athletesContainer}>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <View style={[styles.titleSection, { borderBottomColor: colors.border }]}>
          <ThemedText style={styles.athletesTitle}>Session Athletes</ThemedText>
        </View>

        {Object.entries(athletes).map(([platform, platformAthletes]) => (
          <View key={platform}>
            {platformAthletes.map((athlete, index) => (
              <View 
                key={athlete.name} 
                style={[
                  styles.athleteSection,
                  index !== platformAthletes.length - 1 && { 
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border 
                  }
                ]}
              >
                <ThemedText style={styles.athleteName}>{athlete.name}</ThemedText>
                <ThemedText style={[styles.athleteDetail, { color: colors.secondaryText }]}>
                  Age: {athlete.age}
                </ThemedText>
                <ThemedText style={[styles.athleteDetail, { color: colors.secondaryText }]}>
                  {athlete.club}
                </ThemedText>

                <View style={styles.statsRow}>
                  <View style={styles.statItem}>
                    <ThemedText style={[styles.statLabel, { color: colors.secondaryText }]}>
                      Entry Total
                    </ThemedText>
                    <ThemedText style={styles.statValue}>
                      {athlete.entryTotal}kg
                    </ThemedText>
                  </View>
                  {loading ? (
                    <ActivityIndicator size="small" color={colors.secondaryText} />
                  ) : (
                    <>
                      <View style={styles.statItem}>
                        <ThemedText style={[styles.statLabel, { color: colors.secondaryText }]}>
                          Best Sn
                        </ThemedText>
                        <ThemedText style={styles.statValue}>
                          {athleteBests[athlete.name]?.snatch_best ?? '—'}kg
                        </ThemedText>
                      </View>
                      <View style={styles.statItem}>
                        <ThemedText style={[styles.statLabel, { color: colors.secondaryText }]}>
                          Best CJ
                        </ThemedText>
                        <ThemedText style={styles.statValue}>
                          {athleteBests[athlete.name]?.cj_best ?? '—'}kg
                        </ThemedText>
                      </View>
                      <View style={styles.statItem}>
                        <ThemedText style={[styles.statLabel, { color: colors.secondaryText }]}>
                          Best Total
                        </ThemedText>
                        <ThemedText style={styles.statValue}>
                          {athleteBests[athlete.name]?.total ?? '—'}kg
                        </ThemedText>
                      </View>
                    </>
                  )}
                </View>

                <Pressable
                  style={({ pressed }) => [
                    styles.meetResultsButton,
                    pressed && { opacity: 0.8 }
                  ]}
                  onPress={() => router.push({
                    pathname: '/athlete-results',
                    params: { name: athlete.name }
                  })}
                >
                  <ThemedText style={styles.meetResultsText}>
                    See All Meet Results
                  </ThemedText>
                  <IconSymbol 
                    name={Platform.OS === 'ios' ? "chevron.right" : "chevron-forward"}
                    size={13} 
                    color="#007AFF"
                  />
                </Pressable>
              </View>
            ))}
          </View>
        ))}
      </View>
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

// Add this helper function (or import it if you want to move it to a utilities file)
function calculateWeighInTime(startTime: string): string {
  const [time, period] = startTime.split(' ');
  const [hours, minutes] = time.split(':').map(Number);
  
  // Convert to 24 hour format
  let hour24 = hours;
  if (period === 'PM' && hours !== 12) hour24 += 12;
  if (period === 'AM' && hours === 12) hour24 = 0;
  
  // Subtract 2 hours
  let weighInHour = hour24 - 2;
  
  // Handle day wrap
  if (weighInHour < 0) weighInHour += 24;
  
  // Convert back to 12 hour format
  let weighInPeriod = 'AM';
  if (weighInHour >= 12) {
    weighInPeriod = 'PM';
    if (weighInHour > 12) weighInHour -= 12;
  }
  if (weighInHour === 0) weighInHour = 12;
  
  return `${weighInHour}:${minutes.toString().padStart(2, '0')} ${weighInPeriod}`;
}

const checkAndShowReviewPrompt = async () => {
  try {
    const hasShownReview = await AsyncStorage.getItem('hasShownReview');
    const hasSavedBefore = await AsyncStorage.getItem('hasSavedBefore');
    
    if (!hasSavedBefore && !hasShownReview) {
      // Mark that user has saved a session
      await AsyncStorage.setItem('hasSavedBefore', 'true');
      // Show review prompt
      Alert.alert(
        'Enjoying MeetCal?',
        'Please consider leaving a review! Unless you think a bunch of PDFs are better for some reason.',
        [
          {
            text: 'I Prefer PDFs',
            style: 'cancel',
            onPress: async () => {
              // Mark that we've shown the review prompt
              await AsyncStorage.setItem('hasShownReview', 'true');
            }
          },
          {
            text: 'Leave Review',
            onPress: async () => {
              await AsyncStorage.setItem('hasShownReview', 'true');
              Linking.openURL('https://apps.apple.com/us/app/meetcal/id6741133286');
            }
          }
        ]
      );
    }
  } catch (error) {
    console.error('Error checking review status:', error);
  }
};

// Function to generate unique session IDs
function generateSessionId(meet: MeetName, sessionNumber: number | string, platform: string): string {
  return `${meet}-${sessionNumber}-${platform}`.replace(/\s+/g, '-');
}

export default function SessionDetailsScreen() {
  const [hasCalendarPermission, setHasCalendarPermission] = useState(false);
  const router = useRouter();
  const { saveSession, removeSession, isSessionSaved } = useSavedSessions();
  const { selectedMeet } = useSelectedMeet();
  const schedule = useMemo(() => getSchedule(selectedMeet), [selectedMeet]);
  const rawParams = useLocalSearchParams<{
    id?: string;
    sessionNumber?: string;
    platform?: string;
    weightClass?: string;
    startTime?: string;
    weighInTime?: string;
    date?: string;
    athleteName?: string;
    meet?: MeetName;
  }>();

  // Ensure required params have values
  const params = {
    id: rawParams.id || '',
    sessionNumber: rawParams.sessionNumber || '',
    platform: rawParams.platform || '',
    weightClass: rawParams.weightClass || '',
    startTime: rawParams.startTime || '',
    weighInTime: rawParams.weighInTime || '',
    date: rawParams.date || '',
    athleteName: rawParams.athleteName,
    meet: rawParams.meet || selectedMeet, // Use provided meet or current selected meet
  };

  // Generate the correct session ID using the meet information
  const sessionId = useMemo(() => 
    generateSessionId(params.meet, params.sessionNumber, params.platform),
    [params.meet, params.sessionNumber, params.platform]
  );

  const { currentTheme } = useTheme();
  const platformColors = getPlatformColors();

  // Use the generated sessionId instead of params.id
  const isSaved = isSessionSaved(sessionId);

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

  const sessionDate = useMemo(() => {
    const sessionDay = schedule.find(day => 
      day.sessions.some(s => s.number === parseInt(params.sessionNumber))
    );
    return sessionDay?.date || `Session ${params.sessionNumber}`;
  }, [params.sessionNumber]);

  // Get the platform-specific start time and calculate weigh-in time
  const platformStartTime = useMemo(() => {
    const sessionDay = schedule.find(day => 
      day.sessions.some(s => s.number === parseInt(params.sessionNumber))
    );
    
    const session = sessionDay?.sessions.find(s => 
      s.number === parseInt(params.sessionNumber)
    );

    const platformData = session?.platforms.find(p => 
      p.platform === params.platform
    );

    return platformData?.platformStartTime || params.startTime;
  }, [params.sessionNumber, params.platform, params.startTime]);

  // Calculate weigh-in time based on platform start time
  const platformWeighInTime = useMemo(() => {
    return calculateWeighInTime(platformStartTime);
  }, [platformStartTime]);

  const showSaveAlert = (action: 'save' | 'remove') => {
    const title = action === 'save' ? 'Session Saved' : 'Session Unsaved';
    let message = action === 'save'
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
      removeSession(sessionId);
      showSaveAlert('remove');
    } else {
      saveSession({
        id: sessionId,
        sessionNumber: Number(params.sessionNumber),
        platform: params.platform,
        weightClass: sessionWeightClass || params.weightClass,
        startTime: params.startTime,
        weighInTime: params.weighInTime,
        date: params.date,
        athleteNames: params.athleteName ? [params.athleteName] : undefined,
        meet: params.meet, // Include meet information
      });
      showSaveAlert('save');
      checkAndShowReviewPrompt();
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
      
      // Create Date object in UTC, adding 4 hours for EDT (Eastern Daylight Time)
      return new Date(Date.UTC(year, month - 1, day, adjustedHours + 4, minutes));
    };

    // Find the session and get platform-specific time
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

    // Use platform-specific start time if available, otherwise use session start time
    const session = sessionDay.sessions.find(s => s.number === parseInt(params.sessionNumber));
    const platform = session?.platforms.find(p => p.platform === params.platform);
    const startTime = platform?.platformStartTime || params.startTime;
    const weighInTime = calculateWeighInTime(startTime);

    const startDate = parseTimeString(startTime, sessionDay.fullDate);
    const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);

    const eventDetails = {
      title: `Session ${params.sessionNumber} - Platform ${params.platform}`,
      location: getFullLocation(),
      notes: `Weight Class: ${sessionWeightClass}\nWeigh-in Time: ${weighInTime}`,
      startDate: startDate,
      endDate: endDate,
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
        const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
        const primaryCalendar = calendars.find(cal => 
          cal.accessLevel === Calendar.CalendarAccessLevel.OWNER && 
          cal.allowsModifications
        );

        if (!primaryCalendar) {
          throw new Error('no_calendar');
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
          headerTitle: sessionDate,
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
                {platformWeighInTime} EST
              </ThemedText>
            </View>

            <View style={[styles.section, styles.lastSection]}>
              <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
                Start Time
              </ThemedText>
              <ThemedText style={[styles.value, { color: colors.text }]}>
                {platformStartTime} EST
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
    overflow: 'hidden',
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
  athletesContainer: {
    marginTop: 16,
  },
  titleSection: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  athletesTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  athleteSection: {
    padding: 16,
  },
  athleteNameButton: {
    marginBottom: 4,
  },
  athleteNamePressed: {
    opacity: 0.7,
  },
  athleteName: {
    fontSize: 17,
    fontWeight: '500',
    marginBottom: 4,
  },
  athleteDetail: {
    fontSize: 15,
    marginBottom: 2,
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: 12,
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
  meetResultsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
  },
  meetResultsText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#007AFF',
  },
}); 