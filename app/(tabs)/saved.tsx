import { StyleSheet, View, FlatList, Pressable, Modal, Alert, Platform, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useMemo, useState, useEffect, useCallback } from 'react';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useSavedSessions } from '@/contexts/SavedSessionsContext';
import { useTheme } from '@/contexts/ThemeContext';
import { getPlatformColors } from '@/constants/Colors';
import * as Calendar from 'expo-calendar';
import { SavedSession } from '@/hooks/useSavedSessions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSelectedMeet } from '@/contexts/SelectedMeetContext';
import { MeetName, MeetConfig } from '@/data/types/meet';
import { Schedule as ScheduleType } from '@/types/schedule';
import { getMeetConfig, convertToUTC, formatTimeWithZone, getMeetVenueLocation } from '@/data/meets/config';
import { useUser } from '@clerk/clerk-expo';
import { useSubscription } from '@/contexts/SubscriptionContext';
import React from 'react';
import { fetchScheduleFromDb, transformScheduleData } from '@/lib/database/queries';

// Function to get user-specific storage key
const getSavedWarmupsKey = (userId: string) => `@saved_warmups_${userId}`;
const getSavedSessionsKey = (userId: string) => `@saved_sessions_${userId}`;

// Add function to generate unique session IDs
function generateSessionId(meet: MeetName, sessionNumber: number | string, platform: string): string {
  return `${meet}-${sessionNumber}-${platform}`.replace(/\s+/g, '-');
}

// Update SavedSession type to include meet
declare module '@/hooks/useSavedSessions' {
  interface SavedSession {
    meet: MeetName;
    id: string;  // Now we ensure ID is always present
  }
}

// Add a type that extends SavedSession to include the legacy athleteName property
interface LegacySavedSession extends SavedSession {
  athleteName?: string;
}

// Add type guard at the top of the file
function isMeetName(meet: string | null): meet is MeetName {
  return typeof meet === 'string';
}

async function requestCalendarPermissions() {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  return status === 'granted';
}

async function createCalendarEvents(sessions: Array<{
  date: string;
  startTime: string;
  weighInTime: string;
  sessionNumber: string;
  platform: string;
  weightClass: string;
  meet: MeetName;
}>) {
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

    for (const session of sessions) {
      if (!session.meet) {
        console.warn('Skipping session with no meet:', session);
        continue;
      }

      // Get meet config first
      const meetConfig = await getMeetConfig(session.meet);

      // Convert times to UTC using the meet's time zone
      const startDate = convertToUTC(session.startTime, session.date, session.meet);
      const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);

      // Construct the deep link URL
      const deepLinkUrl = `meetcal://schedule-details?meet=${encodeURIComponent(session.meet)}&sessionNumber=${encodeURIComponent(session.sessionNumber)}&platform=${encodeURIComponent(session.platform)}`;

      await Calendar.createEventAsync(calendarId, {
        title: `Session ${session.sessionNumber} - Platform ${session.platform}`,
        location: getMeetVenueLocation(session.meet),
        notes: `Weight Class: ${session.weightClass}\nWeigh-in Time: ${formatTimeWithZone(session.weighInTime, session.meet)}`,
        startDate: startDate,
        endDate: endDate,
        timeZone: meetConfig.time.timeZoneIdentifier,
        url: deepLinkUrl,
        alarms: [{
          relativeOffset: -60,
        }],
      });
    }
  } catch (error) {
    console.error('Error creating calendar events:', error);
    
    if (error instanceof Error && error.message === 'no_calendar') {
      throw new Error('No suitable calendar found. Please make sure you have at least one calendar set up on your device.');
    }
    
    const errorMessage = Platform.select({
      ios: 'Could not add events to calendar. Please try again.',
      android: 'Could not add events to calendar. Please make sure you have a calendar app installed and try again.',
      default: 'Could not add events to calendar. Please try again.'
    });
    
    throw new Error(errorMessage);
  }
}

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

// Update migration helper to include proper IDs
async function migrateSessionsToMeetSpecific(sessions: any[], currentMeet: MeetName) {
  return sessions.map(session => ({
    ...session,
    // If the session has a meet, keep it, otherwise assign to current meet
    meet: session.meet || currentMeet,
    // Regenerate ID to ensure uniqueness
    id: generateSessionId(session.meet || currentMeet, session.sessionNumber, session.platform)
  }));
}

// Create a separate SessionCard component
const SessionCard = React.memo(({
  item,
  selectedMeet,
  onPress,
  router,
  savedWarmups,
  schedulesMap
}: {
  item: LegacySavedSession;
  selectedMeet: MeetName | null;
  onPress: () => void;
  router: ReturnType<typeof useRouter>;
  savedWarmups: Array<{ id: string; name: string; meet: string; }>;
  schedulesMap: Map<MeetName, ScheduleType>;
}) => {
  const { currentTheme } = useTheme();
  const { meetDetails } = useSelectedMeet();

  // Get time zone abbreviation - moved before early returns to follow Rules of Hooks
  const timeZoneAbbr = useMemo(() => {
    if (!meetDetails?.time.timeZoneIdentifier) return '';
    const date = new Date();
    return new Intl.DateTimeFormat('en-US', {
      timeZone: meetDetails.time.timeZoneIdentifier,
      timeZoneName: 'short'
    }).formatToParts(date).find(part => part.type === 'timeZoneName')?.value || '';
  }, [meetDetails?.time.timeZoneIdentifier]);

  // Ensure meet is defined before using it
  const meet = item.meet || selectedMeet;
  // Add a check for schedule existence in the map
  const schedule = meet && isMeetName(meet) ? schedulesMap.get(meet) : undefined;

  if (!meet || !isMeetName(meet)) {
    console.warn('[SessionCard] No valid meet information available for session:', item);
    return null; // Don't render if meet info is missing
  }

  const sessionNumber = item.sessionNumber?.toString() || '';
  const platform = item.platform || '';
  const weightClass = item.weightClass || '';


  // Add a check to ensure schedule is valid before calling find
  const sessionDay = schedule && Array.isArray(schedule) ? schedule.find(day =>
    day.sessions.some(s => {
      return s.number.toString() === sessionNumber;
    })
  ) : undefined; // If schedule is invalid, sessionDay will be undefined

  const scheduleSession = sessionDay?.sessions.find(s =>
    // Use parseInt safely
    s.number === parseInt(sessionNumber, 10)
  );

  const platformInfo = scheduleSession?.platforms.find(p =>
    p.platform === platform
  );

  // Use platform-specific time if available, otherwise fall back to session time
  const startTime = platformInfo?.platformStartTime || item.startTime || '';
  // Calculate weighInTime based on the determined startTime
  const weighInTime = startTime ? calculateWeighInTime(startTime) : item.weighInTime || '';

  // Get date from sessionDay if available, otherwise fallback to item.date
  const displayDate = sessionDay?.date || 
    (item.date ? new Date(item.date + 'T12:00:00').toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric',
        timeZone: meetDetails?.time.timeZoneIdentifier || 'UTC' // Fallback timezone
      })
    : 'Date TBD');



  const colors = {
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
    link: '#007AFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
  };

  // Format time with the correct timezone abbreviation
  const formatTime = (time: string) => {
    if (!time || !timeZoneAbbr) return 'TBD';
    const [timeStr, period] = time.split(' ');  // Split into time and AM/PM
    return `${timeStr} ${period} ${timeZoneAbbr}`;
  };

  return (
    <Pressable
      style={({ pressed }) => [
        styles.sessionContainer,
        { backgroundColor: colors.card },
        pressed && { backgroundColor: colors.pressed }
      ]}
      onPress={onPress}
    >
      <ThemedText style={[styles.sessionTitle, { color: colors.text }]}>
        {/* Use displayDate derived from schedule map */}
        Session {sessionNumber} {displayDate !== 'Date TBD' ? `• ${displayDate}` : ''}
      </ThemedText>

      {meet && meet !== selectedMeet && (
        <ThemedText style={[styles.meetName, { color: colors.secondaryText }]}>
          {meet.replace(/-/g, ' ')}
        </ThemedText>
      )}

      <View style={styles.timeContainer}>
        <View style={styles.timeRow}>
          <View style={styles.timeBlock}>
            <ThemedText style={[styles.timeLabel, { color: colors.secondaryText }]}>
              Weigh-in:
            </ThemedText>
            <ThemedText style={[styles.timeText, { color: colors.secondaryText }]}>
              {formatTime(weighInTime)}
            </ThemedText>
          </View>
          <View style={styles.timeSeparator} />
          <View style={styles.timeBlock}>
            <ThemedText style={[styles.timeLabel, { color: colors.secondaryText }]}>
              Start:
            </ThemedText>
            <ThemedText style={[styles.timeText, { color: colors.secondaryText }]}>
              {formatTime(startTime)}
            </ThemedText>
          </View>
        </View>
      </View>

      <View style={[styles.platformContainer, { backgroundColor: colors.card }]}>
        <View style={[
          styles.platformIndicator,
          { backgroundColor: getPlatformColors()[platform as keyof ReturnType<typeof getPlatformColors>] }
        ]}>
          <ThemedText style={styles.platformText}>
            {platform}
          </ThemedText>
        </View>
        <ThemedText style={[styles.weightClassText, { color: colors.secondaryText }]}>
          {weightClass}
        </ThemedText>
      </View>

      {/* Display athlete names if available (saved from start list) */}
      {item.athleteNames && Array.isArray(item.athleteNames) && item.athleteNames.length > 0 && (
        <View style={[styles.athleteContainer, { borderTopColor: colors.border }]}>
          <ThemedText style={[styles.athleteLabel, { color: colors.secondaryText }]}>
            {item.athleteNames.length === 1 ? 'Athlete:' : 'Athletes:'}
          </ThemedText>
          <View style={styles.athleteNamesContainer}>
            {item.athleteNames.slice(0, 3).map((name, index) => {
              // Find warmup for THIS specific athlete inside the map
              const athleteWarmup = savedWarmups.find(w => 
                w?.name === name && w?.meet === meet
              );

              return (
                <View key={index} style={styles.athleteRow}>
                  <ThemedText 
                    style={[styles.athleteName, { color: colors.text }]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {name}
                  </ThemedText>
                  {/* Render link if a warmup exists for THIS athlete */}
                  {athleteWarmup && (
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation();
                        router.push({
                          pathname: '/warmup-details',
                          params: { id: athleteWarmup.id } // Use this athlete's warmup ID
                        });
                      }}
                      style={({ pressed }) => [
                        styles.warmupLink,
                        pressed && { opacity: 0.7 }
                      ]}
                    >
                      <ThemedText style={[styles.warmupLinkText, { color: colors.link }]}>
                        Warmups
                      </ThemedText>
                      <IconSymbol name="chevron.right" size={12} color={colors.link} />
                    </Pressable>
                  )}
                </View>
              );
            })}
            {item.athleteNames.length > 3 && (
              <ThemedText style={[styles.athleteMoreText, { color: colors.secondaryText }]}>
                +{item.athleteNames.length - 3} more
              </ThemedText>
            )}
          </View>
        </View>
      )}
      
      {/* For backward compatibility with old saved sessions */}
      {!item.athleteNames && item.athleteName && (
        <View style={[styles.athleteContainer, { borderTopColor: colors.border }]}>
          <ThemedText style={[styles.athleteLabel, { color: colors.secondaryText }]}>
            Athlete:
          </ThemedText>
          <View style={styles.athleteRow}>
            <ThemedText style={[styles.athleteName, { color: colors.text }]}>
              {item.athleteName}
            </ThemedText>
            {/* Also fix backward compatibility section */}
            {(() => {
              const athleteWarmup = savedWarmups.find(w => 
                w?.name === item.athleteName && w?.meet === meet
              );
              return athleteWarmup ? (
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    router.push({
                      pathname: '/warmup-details',
                      params: { id: athleteWarmup.id }
                    });
                  }}
                  style={({ pressed }) => [
                    styles.warmupLink,
                    pressed && { opacity: 0.7 }
                  ]}
                >
                  <ThemedText style={[styles.warmupLinkText, { color: colors.link }]}>
                    Warmups
                  </ThemedText>
                  <IconSymbol name="chevron.right" size={12} color={colors.link} />
                </Pressable>
              ) : null;
            })()}
          </View>
        </View>
      )}

      {/* Display notes if available */}
      {item.notes && item.notes.length > 0 && (
        <View style={[styles.notesContainer, { borderTopColor: colors.border }]}>
          <ThemedText style={[styles.notesLabel, { color: colors.secondaryText }]}>
            Notes:
          </ThemedText>
          {item.notes.split('\n\n').filter(note => note.trim().length > 0).map((note, index, array) => (
            <View key={index} style={styles.noteBlock}>
              <ThemedText style={[styles.notesText, { color: colors.text }]}>
                {note.trim()}
              </ThemedText>
              {index < array.length - 1 && (
                <View style={[styles.noteDivider, { backgroundColor: colors.border }]} />
              )}
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
});

export default function SavedScreen() {
  const { user } = useUser();
  const { savedSessions, saveSession, loadSavedSessions, resetAllSessions } = useSavedSessions();
  const { selectedMeet } = useSelectedMeet();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [letterFilter, setLetterFilter] = useState('');
  const [showFilterModal, setShowFilterModal] = useState(false);
  const { currentTheme } = useTheme();
  const [hasCalendarPermission, setHasCalendarPermission] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMigrated, setHasMigrated] = useState(false);
  const [savedWarmups, setSavedWarmups] = useState<Array<{
    id: string,
    name: string,
    meet: string
  }>>([]);
  const { isSubscribed } = useSubscription();

  // Add state for schedules map and loading
  const [schedulesMap, setSchedulesMap] = useState<Map<MeetName, ScheduleType>>(new Map());
  const [isSchedulesLoading, setIsSchedulesLoading] = useState(false);

  const handleResetSessions = () => {
    if (!user?.id) return;

    Alert.alert(
      'Reset Saved Sessions',
      'Are you sure you want to remove all saved sessions? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              let success = false;
              if (typeof resetAllSessions === 'function') {
                success = await resetAllSessions(selectedMeet ?? undefined);
              }
              const STORAGE_KEYS = [
                getSavedSessionsKey(user.id),
                `savedSessions_${user.id}`,
                `@savedSessions_${user.id}`,
                `sessions_${user.id}`,
              ];
              for (const key of STORAGE_KEYS) {
                const stored = await AsyncStorage.getItem(key);
                if (stored) {
                  let sessions = [];
                  try { sessions = JSON.parse(stored); } catch {}
                  if (Array.isArray(sessions)) {
                    const filtered = sessions.filter(s => s.meet !== selectedMeet);
                    await AsyncStorage.setItem(key, JSON.stringify(filtered));
                  }
                }
              }
              await AsyncStorage.setItem(`@sessions_reset_${user.id}`, Date.now().toString());
              Alert.alert('Success', 'All saved sessions for this meet have been reset.');
            } catch (error) {
              console.error('Error resetting sessions:', error);
              Alert.alert('Error', 'Failed to reset saved sessions.');
            }
          }
        }
      ]
    );
  };

  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
    link: '#007AFF',
  };

  // Update migrateSessions function to use user-specific storage
  const migrateSessions = useCallback(async () => {
    if (!user?.id || !selectedMeet) return;

    try {
      console.log('Starting session migration');
      const STORAGE_KEYS = [
        getSavedSessionsKey(user.id),  // Changed from getSavedWarmupsKey
        `savedSessions_${user.id}`,
        `@savedSessions_${user.id}`,
        `sessions_${user.id}`
      ];
      let needsMigration = false;
      
      for (const key of STORAGE_KEYS) {
        const storedData = await AsyncStorage.getItem(key);
        if (storedData) {
          try {
            const parsed = JSON.parse(storedData);
            if (Array.isArray(parsed) && parsed.length > 0) {
              needsMigration = parsed.some(session => !session.meet);
              if (needsMigration) {
                const migratedSessions = await migrateSessionsToMeetSpecific(parsed, selectedMeet);
                
                await AsyncStorage.setItem(getSavedSessionsKey(user.id), JSON.stringify(migratedSessions));
                
                migratedSessions.forEach(session => {
                  saveSession(session);
                });
              }
            }
          } catch (e) {
            console.error(`Error migrating sessions in ${key}:`, e);
          }
        }
      }
      
      setHasMigrated(true);
    } catch (error) {
      console.error('Error during session migration:', error);
    }
  }, [selectedMeet, saveSession, user?.id]);

  // Filter saved sessions by meet and letter - strict meet filtering
  const filteredSessions = useMemo(() => {
    const meetSessions = savedSessions.filter(session => session.meet === selectedMeet);
    
    if (!letterFilter) {
      return meetSessions.sort((a, b) => a.sessionNumber - b.sessionNumber);
    }
    return meetSessions
      .filter(session => {
        // Add null check for weightClass
        if (!session.weightClass) return false;
        const lastChar = session.weightClass.slice(-1);
        return lastChar === letterFilter;
      })
      .sort((a, b) => a.sessionNumber - b.sessionNumber);
  }, [savedSessions, selectedMeet, letterFilter]);

  // Extract unique letters from saved sessions for the current meet
  const filterOptions = useMemo(() => {
    const letterSet = new Set<string>();
    const meetSessions = savedSessions.filter(session => session.meet === selectedMeet);
    
    meetSessions.forEach(session => {
      // Add null check for weightClass
      if (session.weightClass) {
        const lastChar = session.weightClass.slice(-1);
        if (/^[A-G]$/.test(lastChar)) {
          letterSet.add(lastChar);
        }
      }
    });
    return Array.from(letterSet).sort();
  }, [savedSessions, selectedMeet]);

  const handleFilterSelect = (letter: string) => {
    setLetterFilter(letter);
    setShowFilterModal(false);
  };

  const handleSaveToCalendar = async () => {
    if (!isSubscribed) {
      router.push('/paywall');
      return;
    }

    if (filteredSessions.length === 0) {
      Alert.alert('No Sessions', 'There are no sessions to add to calendar.');
      return;
    }
    // Check if schedules are still loading
    if (isSchedulesLoading) {
        Alert.alert('Loading', 'Schedule data is still loading, please wait a moment.');
        return;
    }

    Alert.alert(
      'Add to Calendar',
      `Add ${filteredSessions.length} session${filteredSessions.length === 1 ? '' : 's'} to your calendar?`,
      [
        {
          text: 'Cancel',
          style: 'cancel'
        },
        {
          text: 'Add',
          onPress: async () => {
            try {
              const hasPermission = await requestCalendarPermissions();
              if (!hasPermission) {
                Alert.alert('Permission Required', 'Calendar permission is required to add sessions.');
                return;
              }

              // Filter out sessions without meet information or missing schedules
              const validSessions = filteredSessions.filter(session => {
                if (!session.meet || !isMeetName(session.meet)) return false;
                const schedule = schedulesMap.get(session.meet);
                return schedule && schedule.length > 0; // Ensure schedule exists and is not empty
              }) as Array<SavedSession & { meet: MeetName }>;

              if (validSessions.length === 0) {
                Alert.alert('Error', 'No valid sessions found with complete schedule information.');
                return;
              }

              const sessionsToAdd = validSessions.map(session => {
                // Get schedule from the map
                const meetSchedule = schedulesMap.get(session.meet)!; // Non-null assertion ok due to filter above
                // Find the specific day and platform info from the loaded schedule
                const sessionDay = meetSchedule.find(day =>
                    day.sessions.some(s => s.number === parseInt(session.sessionNumber.toString()))
                );
                const scheduleSession = sessionDay?.sessions.find(s => s.number === parseInt(session.sessionNumber.toString()));
                const platformInfo = scheduleSession?.platforms.find(p => p.platform === session.platform);
                const startTime = platformInfo?.platformStartTime || session.startTime;
                const weighInTime = startTime ? calculateWeighInTime(startTime) : session.weighInTime;

                return {
                  date: sessionDay?.fullDate || '', // Use fullDate from schedule
                  startTime: startTime,
                  weighInTime: weighInTime,
                  sessionNumber: session.sessionNumber.toString(),
                  platform: session.platform,
                  weightClass: session.weightClass,
                  meet: session.meet
                };
              }).filter(s => s.date && s.startTime && s.weighInTime); // Ensure critical info is present

              if (sessionsToAdd.length !== validSessions.length) {
                 console.warn('Some sessions were skipped due to missing schedule details (date/time).');
                 // Optionally inform the user
              }

              if (sessionsToAdd.length === 0) {
                  Alert.alert('Error', 'Could not extract necessary details for calendar events.');
                  return;
              }

              await createCalendarEvents(sessionsToAdd);
              Alert.alert('Success', 'Sessions have been added to your calendar.');
            } catch (error) {
              Alert.alert('Error', error instanceof Error ? error.message : 'Failed to add sessions to calendar.');
              console.error(error);
            }
          }
        }
      ]
    );
  };

  // Update forceLoadSessions to use loadSavedSessions from the context
  const forceLoadSessions = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      console.log('Force reloading sessions from source...');
      // REMOVE: Old implementation reading from AsyncStorage and calling saveSession
      // ADD: Call loadSavedSessions from the hook
      await loadSavedSessions();
    } catch (error) {
      console.error('Error force reloading sessions:', error);
    } finally {
      setRefreshing(false);
    }
    // ADD: loadSavedSessions to dependency array
  }, [refreshing, loadSavedSessions]);

  // Add logging to loadSavedWarmups
  const loadSavedWarmups = useCallback(async () => {
    try {
      console.log('Loading saved warmups');
      // Check if warmups were reset
      if (user?.id) {
        const resetTimestamp = await AsyncStorage.getItem(`@saved_warmups_reset_${user.id}`);
        if (resetTimestamp) {
          console.log('Found reset timestamp, clearing warmups');
          // Clear the reset flag
          await AsyncStorage.removeItem(`@saved_warmups_reset_${user.id}`);
          setSavedWarmups([]);
          return;
        }

        // Load warmups from user-specific storage
        const storedWarmups = await AsyncStorage.getItem(getSavedWarmupsKey(user.id));
        if (storedWarmups) {
          const warmups = JSON.parse(storedWarmups);
          setSavedWarmups(warmups);
          return;
        }

        // Fallback to legacy storage
        const legacyWarmups = await AsyncStorage.getItem('@saved_warmups');
        if (legacyWarmups) {
          console.log('Found legacy warmups:', legacyWarmups);
          const warmups = JSON.parse(legacyWarmups);
          setSavedWarmups(warmups);
          // Migrate to user-specific storage
          await AsyncStorage.setItem(getSavedWarmupsKey(user.id), legacyWarmups);
        } else {
          console.log('No warmups found');
        }
      }
    } catch (error) {
      console.error('Error loading warmups:', error);
    }
  }, [user?.id]);

  // Load saved warmups when screen focuses
  useFocusEffect(
    useCallback(() => {
      loadSavedWarmups()
    }, [loadSavedWarmups])
  )

  const renderSession = useCallback(({ item }: { item: LegacySavedSession }) => {
    return (
      <SessionCard 
        item={item} 
        selectedMeet={selectedMeet}
        onPress={() => router.push({
          pathname: '/(screens)/schedule-details',
          params: {
            ...item,
            startTime: item.startTime,
            weighInTime: item.weighInTime,
          }
        })}
        router={router}
        savedWarmups={savedWarmups}
        schedulesMap={schedulesMap}
      />
    );
  }, [selectedMeet, router, savedWarmups, schedulesMap]);

  // Only run migration on mount
  useEffect(() => {
    if (!hasMigrated) {
      migrateSessions();
    }
  }, [hasMigrated]);

  // Remove all other effects except calendar permissions
  useEffect(() => {
    (async () => {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      setHasCalendarPermission(status === 'granted');
    })();
  }, []);

  // Fetch schedules for all saved sessions
  useEffect(() => {
    const fetchAllSchedules = async () => {
      if (savedSessions.length === 0) {
        setSchedulesMap(new Map());
        return;
      }

      setIsSchedulesLoading(true);
      const meetNames = Array.from(new Set(savedSessions.map(s => s.meet).filter(isMeetName)));
      const newSchedulesMap = new Map<MeetName, ScheduleType>();

      try {
        await Promise.all(meetNames.map(async (meetName) => {
          try {
            const dbSchedule = await fetchScheduleFromDb(meetName);
            const transformedSchedule = await transformScheduleData(dbSchedule);
            newSchedulesMap.set(meetName, transformedSchedule);
          } catch (fetchError) {
            console.error(`Error fetching schedule for ${meetName}:`, fetchError);
            // Optionally set an empty array or null for this meet to indicate failure
            newSchedulesMap.set(meetName, []); 
          }
        }));
        console.log('[SavedScreen] Schedules map populated:', newSchedulesMap.size);
        setSchedulesMap(newSchedulesMap);
      } catch (error) {
        console.error('Error fetching schedules:', error);
        Alert.alert('Error', 'Could not load schedule data for all saved sessions.');
      } finally {
        setIsSchedulesLoading(false);
      }
    };

    fetchAllSchedules();
  }, [savedSessions]);

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.filterContainer, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <View style={styles.buttonRow}>
          <Pressable
            style={[styles.button, { flex: 1, backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={handleSaveToCalendar}
            disabled={isSchedulesLoading}
          >
            <IconSymbol 
              name="calendar" 
              size={16} 
              color={isSchedulesLoading ? colors.border : (!isSubscribed ? colors.border : colors.secondaryText)} 
            />
            <ThemedText style={[
              styles.buttonText, 
              { color: isSchedulesLoading ? colors.border : (!isSubscribed ? colors.border : colors.secondaryText) }
            ]}>
              {isSchedulesLoading ? 'Loading...' : 'Add to Calendar'}
            </ThemedText>
          </Pressable>

          <Pressable
            style={[styles.button, { flex: 1, backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={handleResetSessions}
          >
            <IconSymbol name={Platform.OS === 'ios' ? 'trash' : 'trash'} size={16} color="#FF3B30" />
            <ThemedText style={[styles.buttonText, { color: '#FF3B30' }]}>
              Delete All
            </ThemedText>
          </Pressable>
        </View>
      </View>

      <FlatList
        data={filteredSessions}
        keyExtractor={item => item.id}
        renderItem={renderSession}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 100 }
        ]}
        ListEmptyComponent={() => (
          <View style={styles.emptyContainer}>
            <ThemedText style={styles.emptyText}>
              {letterFilter 
                ? `No ${letterFilter} sessions found`
                : 'No saved sessions'}
            </ThemedText>
          </View>
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={forceLoadSessions}
            colors={['#007AFF']}
            tintColor={colors.text}
          />
        }
      />

      <Modal
        visible={showFilterModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFilterModal(false)}
      >
        <Pressable 
          style={[styles.modalOverlay, { 
            backgroundColor: currentTheme === 'dark' 
              ? 'rgba(0,0,0,0.6)' 
              : 'rgba(0,0,0,0.4)' 
          }]}
          onPress={() => setShowFilterModal(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <Pressable
              style={({ pressed }) => [
                styles.modalOption,
                { borderBottomColor: colors.border },
                letterFilter === '' && { backgroundColor: colors.pressed },
                pressed && { opacity: 0.8 }
              ]}
              onPress={() => handleFilterSelect('')}
            >
              <ThemedText style={[
                styles.modalOptionText,
                { color: colors.text },
                letterFilter === '' && { color: '#007AFF' }
              ]}>
                All Sessions
              </ThemedText>
              {letterFilter === '' && (
                <IconSymbol name="checkmark" size={16} color="#007AFF" />
              )}
            </Pressable>
            {filterOptions.map(letter => (
              <Pressable
                key={letter}
                style={({ pressed }) => [
                  styles.modalOption,
                  { borderBottomColor: colors.border },
                  letterFilter === letter && { backgroundColor: colors.pressed },
                  pressed && { opacity: 0.8 }
                ]}
                onPress={() => handleFilterSelect(letter)}
              >
                <ThemedText style={[
                  styles.modalOptionText,
                  { color: colors.text },
                  letterFilter === letter && { color: '#007AFF' }
                ]}>
                  {letter} Session
                </ThemedText>
                {letterFilter === letter && (
                  <IconSymbol name="checkmark" size={16} color="#007AFF" />
                )}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  filterContainer: {
    padding: 16,
    backgroundColor: '#F5F5F5',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#C6C6C8',
    gap: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 16,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#C6C6C8',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    elevation: 1,
  },
  buttonText: {
    fontSize: 15,
    color: '#666666',
    fontWeight: '600',
  },
  list: {
    padding: 16,
  },
  sessionContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  sessionContainerPressed: {
    opacity: 0.9,
  },
  sessionTitle: {
    fontSize: 17,
    fontWeight: '600',
    padding: 16,
    paddingBottom: 0,
  },
  timeContainer: {
    padding: 16,
    paddingTop: 8,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  timeBlock: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeSeparator: {
    width: 24,
  },
  timeLabel: {
    fontSize: 14,
    color: '#666',
    marginRight: 4,
  },
  timeText: {
    fontSize: 15,
    color: '#666',
  },
  platformContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    overflow: 'hidden',
    margin: 16,
    marginTop: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
  weightClassText: {
    fontSize: 15,
    color: '#666',
  },
  emptyContainer: {
    padding: 16,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalOptionText: {
    fontSize: 17,
  },
  athleteContainer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E1E1E1',
  },
  athleteLabel: {
    fontSize: 14,
    marginBottom: 4,
  },
  athleteNamesContainer: {
    flexDirection: 'column',
    gap: 4,
    width: '100%',
  },
  athleteName: {
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  athleteMoreText: {
    fontSize: 14,
    fontStyle: 'italic',
  },
  meetName: {
    fontSize: 14,
    fontStyle: 'italic',
    marginLeft: 16,
    marginTop: 4,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  athleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  warmupLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  warmupLinkText: {
    fontSize: 14,
    fontWeight: '500',
  },
  notesContainer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  notesLabel: {
    fontSize: 14,
    marginBottom: 12,
    color: '#8E8E93',
  },
  notesText: {
    fontSize: 15,
    lineHeight: 20,
  },
  noteBlock: {
    marginBottom: 12,
  },
  noteDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },
}); 
