import React from 'react';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { StyleSheet, View, Pressable, Platform, Alert, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Calendar from 'expo-calendar';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Linking } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { getPlatformColors } from '@/data/schedule';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { getMeetConfig, convertToUTC, formatTimeWithZone, getMeetVenueLocation } from '@/data/meets/config';
import { getSchedule } from '@/data/meets/scheduleManager';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useSavedSessions } from '@/contexts/SavedSessionsContext';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { useSelectedMeet } from '@/contexts/SelectedMeetContext';
import { MeetName } from '@/data/types/meet';
import { Platform as PlatformType } from '@/data/types/athletes';
import { SyncManager } from '@/lib/database/sync-manager';
import { LiftResult } from '@/data/types/athletes';
import { saveMeetAthletes } from '@/lib/database/offline-store';

// Update interface names
interface SessionPlatformDetails {
  platform: string;
  platformStartTime?: string;
  weightClass?: string;
}

interface Session {
  number: number;
  platforms: SessionPlatformDetails[];
}

interface ScheduleDay {
  date: string;
  fullDate: string;
  sessions: Session[];
}

// Add interface for Supabase results
interface SupabaseBests {
  snatch_best: number;
  cj_best: number;
  total: number;
}

// Add interface for saved warmups
interface SavedWarmup {
  id: string;
  name: string;
  lastModified: string;
  athlete: {
    name: string;
    club: string;
    snatchPR: number;
    cleanAndJerkPR: number;
  };
  warmupRows: {
    minutesOut: string | number;
    snatch: string | number;
    cleanAndJerk: string | number;
  }[];
  meet: string;
}

// Type for just the athlete data we need
type SessionAthlete = {
  name: string;
  age: number;
  club: string;
  entryTotal: number;
};

// Extended type for athlete data from sync manager
interface CachedAthlete extends SessionAthlete {
  sessionNumber: number;
  platformName: string;
}

async function getSessionAthletes(sessionNumber: number, platform: string, meetId: MeetName, forceRefresh?: boolean) {
  try {
    // If not forcing refresh, try offline store first
    if (!forceRefresh) {
      const syncManager = new SyncManager(meetId);
      const meetData = await syncManager.getMeetData();
      
      const cachedAthletes = meetData.athletes.filter((athlete: LiftResult) => 
        athlete.session?.number === sessionNumber && 
        athlete.session?.platform === platform
      );

      if (cachedAthletes.length > 0) {
        // Sort cached athletes by entry total
        const sortedAthletes = [...cachedAthletes].sort((a, b) => 
          (b.entryTotal || 0) - (a.entryTotal || 0)
        );

        return {
          [platform]: sortedAthletes.map((athlete: LiftResult) => ({
            name: athlete.name,
            age: athlete.age,
            club: athlete.club,
            entryTotal: athlete.entryTotal
          }))
        };
      }
    }

    // Get fresh data from Supabase
    const { data, error } = await supabase
      .from('athletes')
      .select('*')
      .eq('session_number', sessionNumber)
      .eq('session_platform', platform)
      .eq('meet', meetId);

    if (error) {
      console.error('Error fetching athletes:', error);
      return {};
    }

    // If no athletes found for this meet/session/platform, return empty and clear cache
    if (!data || data.length === 0) {
      // Clear any cached data for this meet/session/platform
      const syncManager = new SyncManager(meetId);
      const meetData = await syncManager.getMeetData();
      const updatedAthletes = meetData.athletes.filter((athlete: LiftResult) => 
        athlete.session?.number !== sessionNumber || 
        athlete.session?.platform !== platform
      );
      await saveMeetAthletes(meetId, updatedAthletes);
      
      return {};
    }

    // Transform and sort the data
    const athletes = data.map(athlete => ({
      memberId: athlete.member_id || '',
      name: athlete.name,
      age: athlete.age,
      club: athlete.club,
      gender: athlete.gender || '',
      weightClass: athlete.weight_class || '',
      entryTotal: athlete.entry_total,
      session: {
        number: sessionNumber,
        platform: platform
      }
    } as LiftResult));

    // Sort athletes by entry total
    const sortedAthletes = [...athletes].sort((a, b) => 
      (b.entryTotal || 0) - (a.entryTotal || 0)
    );

    // Save to offline store
    const syncManager = new SyncManager(meetId);
    await saveMeetAthletes(meetId, sortedAthletes);

    return {
      [platform]: sortedAthletes.map(athlete => ({
        name: athlete.name,
        age: athlete.age,
        club: athlete.club,
        entryTotal: athlete.entryTotal
      }))
    };
  } catch (error) {
    console.error('Error in getSessionAthletes:', error);
    return {};
  }
}

async function getAthleteBests(name: string, meetId: MeetName): Promise<SupabaseBests> {
  try {
    console.log(`Fetching bests for athlete: ${name}`);
    // First get max snatch
    const { data: snatchData } = await supabase
      .from('lifting_results')
      .select('snatch_best')
      .eq('name', name)
      .order('snatch_best', { ascending: false })
      .limit(1);

    // Then max C&J
    const { data: cjData } = await supabase
      .from('lifting_results')
      .select('cj_best')
      .eq('name', name)
      .order('cj_best', { ascending: false })
      .limit(1);

    // Finally max total
    const { data: totalData } = await supabase
      .from('lifting_results')
      .select('total')
      .eq('name', name)
      .order('total', { ascending: false })
      .limit(1);

    // Combine results
    const result = {
      snatch_best: (snatchData && snatchData[0]?.snatch_best) || 0,
      cj_best: (cjData && cjData[0]?.cj_best) || 0,
      total: (totalData && totalData[0]?.total) || 0
    };

    console.log(`Found bests for ${name}:`, result);
    return result;
  } catch (error) {
    console.error('Unexpected error in getAthleteBests:', error);
    return { snatch_best: 0, cj_best: 0, total: 0 };
  }
}

function SessionAthletes({ sessionNumber, platform, sessionWeightClass, refreshKey }: { 
  sessionNumber: number;
  platform: string;
  sessionWeightClass: string;
  refreshKey: number;
}) {
  const router = useRouter();
  const { currentTheme } = useTheme();
  const { selectedMeet } = useSelectedMeet();
  const [athleteBests, setAthleteBests] = useState<Record<string, SupabaseBests>>({});
  const [loading, setLoading] = useState(true);
  const [athletes, setAthletes] = useState<Record<string, SessionAthlete[]>>({});
  const [athleteWarmups, setAthleteWarmups] = useState<Record<string, boolean>>({});

  const colors = {
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    link: '#007AFF',
  };

  // Check for saved warmups
  const checkForWarmups = async () => {
    try {
      const savedWarmups = await AsyncStorage.getItem('@saved_warmups');
      if (savedWarmups) {
        const warmups = JSON.parse(savedWarmups);
        const warmupsByAthlete: Record<string, boolean> = {};
        
        // Check each athlete for warmups
        warmups.forEach((warmup: SavedWarmup) => {
          if (warmup.meet === selectedMeet) {
            warmupsByAthlete[warmup.athlete.name] = true;
          }
        });
        
        setAthleteWarmups(warmupsByAthlete);
      }
    } catch (error) {
      console.error('Error checking warmups:', error);
    }
  };

  useEffect(() => {
    const loadAthletes = async () => {
      setLoading(true);
      try {
        const sessionAthletes = await getSessionAthletes(sessionNumber, platform, selectedMeet, refreshKey > 0);
        setAthletes(sessionAthletes);

        // Fetch athlete bests with meet
        const bests: Record<string, SupabaseBests> = {};
        for (const [_, platformAthletes] of Object.entries(sessionAthletes)) {
          for (const athlete of platformAthletes) {
            bests[athlete.name] = await getAthleteBests(athlete.name, selectedMeet);
          }
        }
        setAthleteBests(bests);
        
        // Check for warmups after loading athletes
        await checkForWarmups();
      } catch (error) {
        console.error('Error loading athletes:', error);
        setAthletes({});
      } finally {
        setLoading(false);
      }
    };

    loadAthletes();
  }, [sessionNumber, platform, refreshKey, selectedMeet]);

  const handleAthletePress = (athleteName: string) => {
    router.push({
      pathname: '/athlete-results',
      params: { name: athleteName }
    });
  };

  if (!athletes[platform]?.length) {
    if (loading) {
      return (
        <View style={styles.athletesContainer}>
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <View style={[styles.titleSection, { borderBottomColor: colors.border }]}>
              <ThemedText style={styles.athletesTitle}>Session Athletes</ThemedText>
            </View>
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.secondaryText} />
              <ThemedText style={[styles.loadingText, { color: colors.secondaryText }]}>
                Loading athletes...
              </ThemedText>
            </View>
          </View>
        </View>
      );
    }
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
                <View style={styles.athleteHeader}>
                  <ThemedText style={styles.athleteName}>{athlete.name}</ThemedText>
                  {athleteWarmups[athlete.name] && (
                    <Pressable
                      style={({ pressed }) => [
                        styles.headerLink,
                        pressed && { opacity: 0.8 }
                      ]}
                      onPress={() => {
                        const savedWarmups = AsyncStorage.getItem('@saved_warmups')
                          .then(data => {
                            if (data) {
                              const warmups = JSON.parse(data);
                              const warmup = warmups.find((w: SavedWarmup) => 
                                w.athlete.name === athlete.name && w.meet === selectedMeet
                              );
                              if (warmup) {
                                router.push({
                                  pathname: '/warmup-details',
                                  params: { id: warmup.id }
                                });
                              }
                            }
                          });
                      }}
                    >
                      <ThemedText style={[styles.linkText, { color: colors.link }]}>
                        Warmups
                      </ThemedText>
                      <IconSymbol name="chevron.right" size={13} color={colors.link} />
                    </Pressable>
                  )}
                </View>
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
                    styles.linkButton,
                    pressed && { opacity: 0.8 }
                  ]}
                  onPress={() => router.push({
                    pathname: '/athlete-results',
                    params: { name: athlete.name }
                  })}
                >
                  <ThemedText style={[styles.linkText, { color: colors.link }]}>
                    See All Meet Results
                  </ThemedText>
                  <IconSymbol name="chevron.right" size={13} color={colors.link} />
                </Pressable>
              </View>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

function PlatformBadge({ platform }: { platform: string }) {
  const platformColors = getPlatformColors();
  const backgroundColor = platformColors[platform as PlatformType] || '#808080';
  
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
  const [refreshing, setRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionData, setSessionData] = useState<Session | null>(null);
  const [currentSchedule, setCurrentSchedule] = useState(() => getSchedule(selectedMeet));
  const [refreshKey, setRefreshKey] = useState(0);
  const [syncManager] = useState(() => new SyncManager(selectedMeet));

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

  useEffect(() => {
    const loadSessionData = async () => {
      setIsLoading(true);
      try {
        // Get session data from the schedule
        const defaultSchedule = getSchedule(selectedMeet);
        const day = defaultSchedule.find(day => 
          day.sessions.some(s => s.number === parseInt(params.sessionNumber))
        );
        const session = day?.sessions.find(s => s.number === parseInt(params.sessionNumber)) || null;
        setSessionData(session);
      } catch (error) {
        console.error('Error loading session data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSessionData();
  }, [selectedMeet, params.sessionNumber]);

  // Get the correct weight class from current schedule
  const sessionWeightClass = useMemo(() => {
    const sessionDay = currentSchedule.find(day => 
      day.sessions.some(s => s.number === parseInt(params.sessionNumber))
    );
    
    const session = sessionDay?.sessions.find(s => 
      s.number === parseInt(params.sessionNumber)
    );

    const platformData = session?.platforms.find(p => 
      p.platform === params.platform
    );

    return platformData?.weightClass || params.weightClass;
  }, [currentSchedule, params.sessionNumber, params.platform, params.weightClass]);

  const sessionDate = useMemo(() => {
    const sessionDay = currentSchedule.find(day => 
      day.sessions.some(s => s.number === parseInt(params.sessionNumber))
    );
    return sessionDay?.date || `Session ${params.sessionNumber}`;
  }, [currentSchedule, params.sessionNumber]);

  // Get the platform-specific start time and calculate weigh-in time
  const platformStartTime = useMemo(() => {
    const sessionDay = currentSchedule.find(day => 
      day.sessions.some(s => s.number === parseInt(params.sessionNumber))
    );
    
    const session = sessionDay?.sessions.find(s => 
      s.number === parseInt(params.sessionNumber)
    );

    const platformData = session?.platforms.find(p => 
      p.platform === params.platform
    );

    return platformData?.platformStartTime || params.startTime;
  }, [currentSchedule, params.sessionNumber, params.platform, params.startTime]);

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

    // Find the session and get platform-specific time
    const sessionDay = currentSchedule.find((day: ScheduleDay) => 
      day.sessions.some((session: Session) => 
        session.number === parseInt(params.sessionNumber) &&
        session.platforms.some((platform: SessionPlatformDetails) => platform.platform === params.platform)
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

    // Convert times to UTC using the meet's time zone
    const startDate = convertToUTC(startTime, sessionDay.fullDate, params.meet);
    const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);

    const eventDetails = {
      title: `Session ${params.sessionNumber} - Platform ${params.platform}`,
      location: getMeetVenueLocation(params.meet),
      notes: `Weight Class: ${sessionWeightClass}\nWeigh-in Time: ${formatTimeWithZone(weighInTime, params.meet)}`,
      startDate: startDate,
      endDate: endDate,
      timeZone: getMeetConfig(params.meet).time.timeZoneIdentifier,
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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Get fresh data from SyncManager
      const meetData = await syncManager.getMeetData();
      if (meetData.schedule) {
        const day = meetData.schedule.find(day => 
          day.sessions.some(s => s.number === parseInt(params.sessionNumber))
        );
        const session = day?.sessions.find(s => 
          s.number === parseInt(params.sessionNumber)
        ) || null;
        setSessionData(session);
        // Update the current schedule with fresh data
        setCurrentSchedule(meetData.schedule);
      }
      // Trigger athlete data refresh
      setRefreshKey(prev => prev + 1);
    } catch (error) {
      console.error('Refresh failed:', error);
    } finally {
      setRefreshing(false);
    }
  }, [syncManager, params.sessionNumber]);

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
          { paddingTop: 16 }
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.text}
          />
        }
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
                <PlatformBadge platform={params.platform} />
              </View>
            </View>

            <View style={[styles.section, { borderBottomColor: colors.border }]}>
              <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
                Weight Class
              </ThemedText>
              <ThemedText style={[styles.value, { color: colors.text }]}>
                {sessionWeightClass}
              </ThemedText>
            </View>

            <View style={[styles.section, { borderBottomColor: colors.border }]}>
              <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
                Weigh-in Time
              </ThemedText>
              <ThemedText style={[styles.value, { color: colors.text }]}>
                {formatTimeWithZone(platformWeighInTime, params.meet)}
              </ThemedText>
            </View>

            <View style={[styles.section, styles.lastSection]}>
              <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
                Start Time
              </ThemedText>
              <ThemedText style={[styles.value, { color: colors.text }]}>
                {formatTimeWithZone(platformStartTime, params.meet)}
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
            refreshKey={refreshKey}
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
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  card: {
    borderRadius: 10,
    marginBottom: 16,
    overflow: 'hidden',
  },
  section: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: 13,
    marginBottom: 4,
  },
  value: {
    fontSize: 17,
  },
  athletesContainer: {
    marginTop: 16,
  },
  athletesTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  titleSection: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  athleteSection: {
    padding: 16,
  },
  athleteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  athleteName: {
    fontSize: 17,
    fontWeight: '600',
  },
  headerLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
  },
  linkText: {
    fontSize: 15,
    fontWeight: '500',
  },
  athleteDetail: {
    fontSize: 15,
    marginBottom: 2,
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
  loadingContainer: {
    padding: 32,
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 15,
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
  lastSection: {
    borderBottomWidth: 0,
  },
  linksContainer: {
    marginTop: 12,
    gap: 8,
  },
}); 