import { StyleSheet, View, ScrollView, Pressable, Platform, KeyboardAvoidingView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useState, useEffect, useRef } from 'react';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useTheme } from '@/contexts/ThemeContext';
import { useSavedSessions } from '@/contexts/SavedSessionsContext';
import { useSelectedMeet } from '@/contexts/SelectedMeetContext';
import { TextInput } from '@/components/ui/TextInput';
import { Dropdown } from '@/components/ui/Dropdown';
import { useUser } from '@clerk/clerk-expo';
import { SavedSession } from '@/hooks/useSavedSessions';
import { SyncManager } from '@/lib/database/sync-manager';
import { Schedule } from '@/types/schedule';

// Function to generate unique session IDs
function generateSessionId(meet: string, sessionNumber: string | number, platform: string): string {
  return `${meet}-${sessionNumber}-${platform}`.replace(/\s+/g, '-');
}

export default function CreateSessionScreen() {
  const { user } = useUser();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { currentTheme } = useTheme();
  const { saveSession, savedSessions } = useSavedSessions();
  const { selectedMeet } = useSelectedMeet();

  const [sessionNumber, setSessionNumber] = useState('');
  const [platform, setPlatform] = useState('');
  const [weightClass, setWeightClass] = useState('');
  const [startTime, setStartTime] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [platformOptions, setPlatformOptions] = useState<string[]>([]);
  const [schedule, setSchedule] = useState<Schedule>([]);
  const [syncManager, setSyncManager] = useState<SyncManager | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);

  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
  };

  // Initialize sync manager when selectedMeet changes
  useEffect(() => {
    if (selectedMeet) {
      setSyncManager(new SyncManager(selectedMeet));
    } else {
      setSyncManager(null);
    }
  }, [selectedMeet]);

  // Load schedule data and update platform options
  useEffect(() => {
    const loadScheduleData = async () => {
      if (!selectedMeet || !syncManager) {
        setPlatformOptions([]);
        setPlatform('');
        setWeightClass('');
        setSchedule([]);
        return;
      }

      try {
        const meetData = await syncManager.getMeetData();
        const scheduleData = meetData.schedule || [];
        setSchedule(scheduleData);

        // Get all unique platforms across all sessions
        const allPlatforms = new Set<string>();
        let sessionCount = 0;
        let platformCount = 0;
        
        scheduleData.forEach(day => {
          day.sessions.forEach(session => {
            sessionCount++;
            session.platforms.forEach(platform => {
              platformCount++;
              allPlatforms.add(platform.platform);
            });
          });
        });

        console.log('Schedule analysis:', {
          totalDays: scheduleData.length,
          totalSessions: sessionCount,
          totalPlatformEntries: platformCount,
          uniquePlatforms: allPlatforms.size
        });

        // Define the desired platform order
        const platformOrder = ['Red', 'White', 'Blue', 'Stars', 'Stripes', 'Rogue'];
        
        // Sort platforms according to the defined order
        const platforms = Array.from(allPlatforms).sort((a, b) => {
          const indexA = platformOrder.indexOf(a);
          const indexB = platformOrder.indexOf(b);
          
          // If both platforms are in the order array, sort by their position
          if (indexA !== -1 && indexB !== -1) {
            return indexA - indexB;
          }
          
          // If only one platform is in the order array, prioritize it
          if (indexA !== -1) return -1;
          if (indexB !== -1) return 1;
          
          // If neither platform is in the order array, sort alphabetically
          return a.localeCompare(b);
        });

        setPlatformOptions(platforms);
      } catch (error) {
        console.error('Error loading schedule:', error);
        setPlatformOptions([]);
        setSchedule([]);
      }
    };

    console.log('Schedule effect triggered', { selectedMeet, hasSyncManager: !!syncManager });
    loadScheduleData();
  }, [selectedMeet, syncManager]);

  // Auto-fill weight class, start time, and date when platform and session are selected
  useEffect(() => {
    if (!selectedMeet || !sessionNumber || !platform || schedule.length === 0) return;

    const sessionDay = schedule.find(day => 
      day.sessions.some(s => s.number === Number(sessionNumber))
    );
    
    const scheduleSession = sessionDay?.sessions.find(s => 
      s.number === Number(sessionNumber)
    );

    if (scheduleSession) {
      // Set start time
      setStartTime(scheduleSession.startTime);
      
      // Set date from the session day and format it as MM-DD-YY
      if (sessionDay) {
        setDate(sessionDay.fullDate);
      }

      // Set weight class from the platform info
      const platformInfo = scheduleSession.platforms.find(p => 
        p.platform === platform
      );
      if (platformInfo?.weightClass) {
        setWeightClass(platformInfo.weightClass);
      }
    }
  }, [platform, sessionNumber, selectedMeet, schedule]);

  const handleSave = async () => {
    if (!user?.id || !selectedMeet) return;

    const newSession: SavedSession = {
      id: generateSessionId(selectedMeet, sessionNumber, platform),
      meet: selectedMeet,
      sessionNumber: parseInt(sessionNumber),
      platform,
      weightClass,
      startTime,
      date,
      notes,
      weighInTime: '', // Empty string for weigh-in time as per requirements
    };

    // Check if session already exists and merge notes if needed
    const existingSession = savedSessions.find(s => s.id === newSession.id);
    if (existingSession && notes) {
      // If both sessions have notes, combine them
      if (existingSession.notes) {
        newSession.notes = `${existingSession.notes}\n\n${notes}`;
      }
      // If existing session has athlete names, preserve them
      if (existingSession.athleteNames) {
        newSession.athleteNames = existingSession.athleteNames;
      }
    }

    await saveSession(newSession);
    router.back();
  };

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: 'Create Session',
          headerBackTitle: 'Back',
          headerTitleStyle: {
            color: colors.text,
          },
          headerTintColor: colors.text,
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          animation: 'slide_from_right',
          headerStyle: {
            backgroundColor: colors.background,
          },
          headerShadowVisible: false,
        }}
      />

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        <ScrollView 
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: 32 }
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={true}
        >
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <View style={[styles.formRow, { borderBottomColor: colors.border }]}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Session Number
              </ThemedText>
              <TextInput
                value={sessionNumber}
                onChangeText={setSessionNumber}
                placeholder="Enter session number"
                keyboardType="numeric"
                style={[styles.input, { backgroundColor: colors.background, color: colors.text }]}
              />
            </View>

            <View style={[styles.formRow, { borderBottomColor: colors.border }]}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Platform
              </ThemedText>
              <Dropdown
                value={platform}
                options={platformOptions}
                onSelect={setPlatform}
                placeholder="Select platform"
              />
            </View>

            <View style={[styles.formRow, { borderBottomColor: colors.border }]}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Weight Class
              </ThemedText>
              <TextInput
                value={weightClass}
                onChangeText={setWeightClass}
                placeholder="Autofilled from schedule"
                style={[styles.input, { backgroundColor: colors.background, color: colors.text }]}
                editable={false}
              />
            </View>

            <View style={[styles.formRow, { borderBottomColor: colors.border }]}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Start Time
              </ThemedText>
              <TextInput
                value={startTime}
                onChangeText={setStartTime}
                placeholder="Enter start time"
                style={[styles.input, { backgroundColor: colors.background, color: colors.text }]}
              />
            </View>

            <View style={[styles.formRow, { borderBottomColor: colors.border }]}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Date
              </ThemedText>
              <TextInput
                value={date}
                onChangeText={setDate}
                placeholder="Enter date"
                style={[styles.input, { backgroundColor: colors.background, color: colors.text }]}
              />
            </View>

            <View style={[styles.formRow, { borderBottomColor: colors.border }]}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Notes
              </ThemedText>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Enter any notes"
                multiline
                numberOfLines={4}
                style={[styles.input, styles.textArea, { backgroundColor: colors.background, color: colors.text }]}
                onFocus={() => {
                  // Add a small delay to ensure the keyboard is shown
                  setTimeout(() => {
                    scrollViewRef.current?.scrollToEnd({ animated: true });
                  }, 100);
                }}
              />
            </View>
          </View>
        </ScrollView>

        <View style={[
          styles.saveButtonContainer, 
          { 
            backgroundColor: colors.background,
            paddingBottom: Math.max(insets.bottom, 12),
            paddingTop: 12,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.border
          }
        ]}>
          <Pressable
            style={[
              styles.saveButton,
              { 
                backgroundColor: '#007AFF',
                opacity: sessionNumber && platform ? 1 : 0.5 
              }
            ]}
            onPress={handleSave}
            disabled={!sessionNumber || !platform}
          >
            <ThemedText style={styles.saveButtonText}>
              Save Session
            </ThemedText>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
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
  formRow: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: 16,
    marginBottom: 8,
  },
  input: {
    padding: 12,
    borderRadius: 8,
    fontSize: 17,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  saveButtonContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 5,
  },
  saveButton: {
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
}); 