import { StyleSheet, View, FlatList, Pressable, Modal, Alert, Platform, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useMemo, useState, useEffect, useCallback } from 'react';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useSavedSessions } from '@/contexts/SavedSessionsContext';
import { useTheme } from '@/contexts/ThemeContext';
import { getPlatformColors, schedule } from '@/data/schedule';
import * as Calendar from 'expo-calendar';
import { getFullLocation } from '@/config/venue';
import { SavedSession } from '@/hooks/useSavedSessions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSelectedMeet } from '@/contexts/SelectedMeetContext';
import { MeetName } from '@/data/types/meet';
import { getSchedule } from '@/data/meets/scheduleManager';
import { Schedule } from '@/data/types/schedule';
import { getMeetConfig, convertToUTC, formatTimeWithZone, getMeetVenueLocation } from '@/data/meets/config';

const SAVED_SESSIONS_KEY = '@saved_sessions';

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
      // Find session in schedule to get platform-specific time
      const sessionDay = schedule.find(day => 
        day.sessions.some(s => s.number === parseInt(session.sessionNumber))
      );
      
      const scheduleSession = sessionDay?.sessions.find(s => 
        s.number === parseInt(session.sessionNumber)
      );

      const platform = scheduleSession?.platforms.find(p => 
        p.platform === session.platform
      );

      // Use platform-specific time if available
      const startTime = platform?.platformStartTime || session.startTime;
      const weighInTime = calculateWeighInTime(startTime);

      // Convert times to UTC using the meet's time zone
      const startDate = convertToUTC(startTime, session.date, session.meet);
      const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);

      const meetConfig = getMeetConfig(session.meet);

      await Calendar.createEventAsync(calendarId, {
        title: `Session ${session.sessionNumber} - Platform ${session.platform}`,
        location: getMeetVenueLocation(session.meet),
        notes: `Weight Class: ${session.weightClass}\nWeigh-in Time: ${formatTimeWithZone(weighInTime, session.meet)}`,
        startDate: startDate,
        endDate: endDate,
        timeZone: meetConfig.time.timeZoneIdentifier,
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

export default function SavedScreen() {
  const { savedSessions, saveSession } = useSavedSessions();
  const { selectedMeet } = useSelectedMeet();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [letterFilter, setLetterFilter] = useState('');
  const [showFilterModal, setShowFilterModal] = useState(false);
  const { currentTheme } = useTheme();
  const [hasCalendarPermission, setHasCalendarPermission] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMigrated, setHasMigrated] = useState(false);

  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
  };

  // Add migrateSessions function
  const migrateSessions = useCallback(async () => {
    try {
      // Try all possible storage keys
      const STORAGE_KEYS = ['@saved_sessions', 'savedSessions', '@savedSessions', 'sessions'];
      let needsMigration = false;
      
      for (const key of STORAGE_KEYS) {
        const storedData = await AsyncStorage.getItem(key);
        if (storedData) {
          try {
            const parsed = JSON.parse(storedData);
            if (Array.isArray(parsed) && parsed.length > 0) {
              // Check if any session lacks meet info
              needsMigration = parsed.some(session => !session.meet);
              if (needsMigration) {
                console.log(`Migrating ${parsed.length} sessions in ${key}`);
                const migratedSessions = await migrateSessionsToMeetSpecific(parsed, selectedMeet);
                
                // Save migrated sessions back to storage
                await AsyncStorage.setItem(key, JSON.stringify(migratedSessions));
                
                // Update context if using it
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
  }, [selectedMeet, saveSession]);

  // Filter saved sessions by meet and letter - strict meet filtering
  const filteredSessions = useMemo(() => {
    const meetSessions = savedSessions.filter(session => session.meet === selectedMeet);
    
    if (!letterFilter) {
      return meetSessions.sort((a, b) => a.sessionNumber - b.sessionNumber);
    }
    return meetSessions
      .filter(session => session.weightClass.slice(-1) === letterFilter)
      .sort((a, b) => a.sessionNumber - b.sessionNumber);
  }, [savedSessions, selectedMeet, letterFilter]);

  // Extract unique letters from saved sessions for the current meet
  const filterOptions = useMemo(() => {
    const letterSet = new Set<string>();
    const meetSessions = savedSessions.filter(session => session.meet === selectedMeet);
    
    meetSessions.forEach(session => {
      const lastChar = session.weightClass.slice(-1);
      if (/^[A-G]$/.test(lastChar)) {
        letterSet.add(lastChar);
      }
    });
    return Array.from(letterSet).sort();
  }, [savedSessions, selectedMeet]);

  const handleFilterSelect = (letter: string) => {
    setLetterFilter(letter);
    setShowFilterModal(false);
  };

  const handleSaveToCalendar = async () => {
    if (filteredSessions.length === 0) {
      Alert.alert('No Sessions', 'There are no sessions to add to calendar.');
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

              const sessionsToAdd = filteredSessions.map(session => {
                const meetSchedule = getSchedule(session.meet);
                return {
                  date: meetSchedule.find(day => 
                    day.sessions.some(s => s.number === parseInt(session.sessionNumber.toString()))
                  )?.fullDate || '',
                  startTime: session.startTime,
                  weighInTime: session.weighInTime,
                  sessionNumber: session.sessionNumber.toString(),
                  platform: session.platform,
                  weightClass: session.weightClass,
                  meet: session.meet || selectedMeet
                };
              });

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

  const renderSession = ({ item }: { item: LegacySavedSession }) => {
    // Find session in schedule to get platform-specific time
    const schedule = getSchedule(item.meet || selectedMeet);
    const sessionDay = schedule.find(day => 
      day.sessions.some(s => s.number === parseInt(item.sessionNumber.toString()))
    );
    
    const scheduleSession = sessionDay?.sessions.find(s => 
      s.number === parseInt(item.sessionNumber.toString())
    );

    const platform = scheduleSession?.platforms.find(p => 
      p.platform === item.platform
    );

    // Use platform-specific time if available, otherwise fall back to session time
    const startTime = platform?.platformStartTime || item.startTime;
    const weighInTime = calculateWeighInTime(startTime);
    const meetConfig = getMeetConfig(item.meet || selectedMeet);

    return (
      <Pressable
        style={({ pressed }) => [
          styles.sessionContainer,
          { backgroundColor: colors.card },
          pressed && { backgroundColor: colors.pressed }
        ]}
        onPress={() => router.push({
          pathname: '/(screens)/schedule-details',
          params: {
            ...item,
            startTime,
            weighInTime,
          }
        })}
      >
        <ThemedText style={[styles.sessionTitle, { color: colors.text }]}>
          Session {item.sessionNumber} • {sessionDay?.date}
        </ThemedText>

        {/* Add meet name if different from selected meet */}
        {item.meet && item.meet !== selectedMeet && (
          <ThemedText style={[styles.meetName, { color: colors.secondaryText }]}>
            {item.meet.replace(/-/g, ' ')}
          </ThemedText>
        )}

        <View style={styles.timeContainer}>
          <View style={styles.timeRow}>
            <View style={styles.timeBlock}>
              <ThemedText style={[styles.timeLabel, { color: colors.secondaryText }]}>
                Weigh-in:
              </ThemedText>
              <ThemedText style={[styles.timeText, { color: colors.secondaryText }]}>
                {formatTimeWithZone(weighInTime, item.meet || selectedMeet)}
              </ThemedText>
            </View>
            <View style={styles.timeSeparator} />
            <View style={styles.timeBlock}>
              <ThemedText style={[styles.timeLabel, { color: colors.secondaryText }]}>
                Start:
              </ThemedText>
              <ThemedText style={[styles.timeText, { color: colors.secondaryText }]}>
                {formatTimeWithZone(startTime, item.meet || selectedMeet)}
              </ThemedText>
            </View>
          </View>
        </View>
        
        <View style={[styles.platformContainer, { backgroundColor: colors.card }]}>
          <View style={[
            styles.platformIndicator,
            { backgroundColor: getPlatformColors()[item.platform as keyof ReturnType<typeof getPlatformColors>] }
          ]}>
            <ThemedText style={styles.platformText}>
              {item.platform}
            </ThemedText>
          </View>
          <ThemedText style={[styles.weightClassText, { color: colors.secondaryText }]}>
            {item.weightClass}
          </ThemedText>
        </View>
        
        {/* Display athlete names if available (saved from start list) */}
        {item.athleteNames && item.athleteNames.length > 0 && (
          <View style={[styles.athleteContainer, { borderTopColor: colors.border }]}>
            <ThemedText style={[styles.athleteLabel, { color: colors.secondaryText }]}>
              {item.athleteNames.length === 1 ? 'Athlete:' : 'Athletes:'}
            </ThemedText>
            <View style={styles.athleteNamesContainer}>
              {item.athleteNames.slice(0, 3).map((name, index) => (
                <ThemedText 
                  key={index} 
                  style={[styles.athleteName, { color: colors.text }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {name}
                </ThemedText>
              ))}
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
            <ThemedText style={[styles.athleteName, { color: colors.text }]}>
              {item.athleteName}
            </ThemedText>
          </View>
        )}
      </Pressable>
    );
  };

  // Memoize forceLoadSessions
  const forceLoadSessions = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    
    try {
      // Just trigger a context reload
      const storedData = await AsyncStorage.getItem(SAVED_SESSIONS_KEY);
      if (storedData) {
        const parsed = JSON.parse(storedData);
        if (Array.isArray(parsed)) {
          parsed.forEach(session => {
            // Ensure each session has a proper unique ID
            const sessionWithId = {
              ...session,
              id: generateSessionId(session.meet || selectedMeet, session.sessionNumber, session.platform)
            };
            saveSession(sessionWithId);
          });
        }
      }
    } catch (error) {
      console.error('Error loading sessions:', error);
    } finally {
      setRefreshing(false);
    }
  }, [saveSession, refreshing, selectedMeet]);

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

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.filterContainer, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <View style={styles.buttonRow}>
          <Pressable
            style={[styles.button, { flex: 1, backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setShowFilterModal(true)}
          >
            <ThemedText style={[styles.buttonText, { color: colors.secondaryText }]}>
              Filter By Session
            </ThemedText>
            <IconSymbol name="chevron.down" size={12} color={colors.secondaryText} />
          </Pressable>
          
          <Pressable
            style={[styles.button, { flex: 1, backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={handleSaveToCalendar}
          >
            <IconSymbol name="calendar" size={16} color={colors.secondaryText} />
            <ThemedText style={[styles.buttonText, { color: colors.secondaryText }]}>
              Add to Calendar
            </ThemedText>
          </Pressable>
        </View>

        <Pressable
          style={[styles.button, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push('/(screens)/warmups')}
        >
          <IconSymbol name="bookmark" size={16} color={colors.secondaryText} />
          <ThemedText style={[styles.buttonText, { color: colors.secondaryText }]}>
            Saved Warmups
          </ThemedText>
        </Pressable>
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
}); 