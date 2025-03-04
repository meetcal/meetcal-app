import { View, TextInput, StyleSheet, ScrollView, Platform, Pressable, Modal, ActivityIndicator, Switch, Alert } from 'react-native'
import { useState, useEffect } from 'react'
import { router, Stack } from 'expo-router'
import { Picker } from '@react-native-picker/picker'
import { createUserProfile } from '@/lib/profile'
import { ThemedText } from '@/components/ThemedText'
import { ThemedView } from '@/components/ThemedView'
import { ThemedButton } from '@/components/ui/ThemedButton'
import { useTheme } from '@/contexts/ThemeContext'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { liftingResults, LiftResult } from '@/data/athletes'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useSavedSessions } from '@/contexts/SavedSessionsContext'
import { schedule } from '@/data/schedule'

export default function UserProfileScreen() {
  const { currentTheme } = useTheme()
  const insets = useSafeAreaInsets()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'Athlete' | 'Coach' | 'Spectator' | 'Official' | 'Vendor' | 'Media'>('Athlete')
  const [clubName, setClubName] = useState<string>('None')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRolePicker, setShowRolePicker] = useState(false)
  const [showClubPicker, setShowClubPicker] = useState(false)
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [autoSaveSessions, setAutoSaveSessions] = useState(false)

  const colors = {
    background: currentTheme === 'dark' ? '#0A1A2F' : '#F0F7FF',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    input: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
  }

  // Extract unique club names from athletes data
  const clubOptions = ['None', ...Array.from(
    new Set(liftingResults.map(athlete => athlete.club))
  ).sort()]

  // Get the correct functions from the context
  const savedSessionsContext = useSavedSessions()

  // Function to find and save all sessions for a club
  const saveAllClubSessions = async (club: string) => {
    // Move this to a background process
    setTimeout(async () => {
      if (club === 'None') return;
      
      try {
        console.log('Finding sessions for club (background):', club);
        
        // Get all athletes from this club
        const clubAthletes = liftingResults.filter(athlete => athlete.club === club);
        console.log(`Found ${clubAthletes.length} athletes for ${club}`);
        
        if (clubAthletes.length === 0) return;
        
        // Get all unique sessions for these athletes
        const sessionsToSave = new Map();
        
        clubAthletes.forEach(athlete => {
          if (athlete.session) {
            const sessionKey = `${athlete.session.number}-${athlete.session.platform}`;
            
            if (!sessionsToSave.has(sessionKey)) {
              // Find session details in schedule
              const sessionDay = schedule.find(day => 
                day.sessions.some(s => s.number === athlete.session?.number)
              );
              
              const scheduleSession = sessionDay?.sessions.find(s => 
                s.number === athlete.session?.number
              );
              
              const platform = scheduleSession?.platforms.find(p => 
                p.platform === athlete.session?.platform
              );
              
              if (sessionDay && scheduleSession) {
                // Use platform-specific time if available
                const startTime = platform?.platformStartTime || scheduleSession.startTime;
                const weighInTime = scheduleSession.weighInTime;
                
                // Create a session object with the exact format expected
                sessionsToSave.set(sessionKey, {
                  id: `session-${athlete.session.number}-${athlete.session.platform}`,
                  sessionNumber: athlete.session.number,
                  platform: athlete.session.platform,
                  weightClass: athlete.weightClass,
                  startTime,
                  weighInTime,
                  athleteNames: [athlete.name],
                  date: sessionDay.fullDate
                });
              }
            } else {
              // Add athlete name to existing session
              const session = sessionsToSave.get(sessionKey);
              if (!session.athleteNames.includes(athlete.name)) {
                session.athleteNames.push(athlete.name);
              }
            }
          }
        });
        
        // Try multiple storage keys that might be used by the context
        const possibleKeys = [
          '@saved_sessions',
          'savedSessions',
          '@savedSessions',
          'sessions'
        ];
        
        // Log all current values for debugging
        for (const key of possibleKeys) {
          const value = await AsyncStorage.getItem(key);
          console.log(`Current value for ${key}:`, value);
        }
        
        // Get current saved sessions from all possible keys
        let savedSessions = [];
        let storageKeyUsed = '';
        
        for (const key of possibleKeys) {
          const storedData = await AsyncStorage.getItem(key);
          if (storedData) {
            try {
              const parsed = JSON.parse(storedData);
              if (Array.isArray(parsed) && parsed.length > 0) {
                savedSessions = parsed;
                storageKeyUsed = key;
                console.log(`Found existing sessions in key: ${key}`);
                break;
              }
            } catch (e) {
              console.error(`Error parsing data from ${key}:`, e);
            }
          }
        }
        
        if (!storageKeyUsed) {
          // If no existing data found, use the first key
          storageKeyUsed = possibleKeys[0];
          console.log(`No existing sessions found, will use key: ${storageKeyUsed}`);
        }
        
        // Add new sessions if they don't already exist
        let sessionsAdded = 0;
        const sessionsArray = Array.from(sessionsToSave.values());
        
        sessionsArray.forEach(session => {
          const exists = savedSessions.some(s => s.id === session.id);
          if (!exists) {
            savedSessions.push(session);
            sessionsAdded++;
          }
        });
        
        // Save to all possible keys to ensure it works
        if (sessionsAdded > 0) {
          console.log(`Adding ${sessionsAdded} sessions to saved list (background)`);
          
          const jsonData = JSON.stringify(savedSessions);
          
          for (const key of possibleKeys) {
            await AsyncStorage.setItem(key, jsonData);
            console.log(`Saved sessions to key: ${key}`);
          }
          
          // Set a flag that the app can check to know sessions were updated
          await AsyncStorage.setItem('@sessions_last_updated', Date.now().toString());
          
          // Create a special notification key that includes the timestamp
          // This ensures the key is different each time, which can trigger observers
          const notificationKey = `@sessions_updated_${Date.now()}`;
          await AsyncStorage.setItem(notificationKey, 'true');
          
          console.log('Sessions saved successfully (background)');
          
          // Add a message to the user to check the Saved tab
          setTimeout(() => {
            Alert.alert(
              'Sessions Saved',
              `${sessionsAdded} sessions for ${club} have been saved. Check the Saved tab to view them.`,
              [{ text: 'OK' }]
            );
          }, 2000); // Show after a delay to ensure the user is on the subscription screen
        } else {
          console.log('No new sessions to add');
        }
        
      } catch (error) {
        console.error('Error saving club sessions (background):', error);
      }
    }, 0);
  };

  const handleSubmit = async () => {
    if (!name || !email || !role) {
      setError('Please fill in all fields')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Add retry logic for profile creation
      let retryCount = 0;
      const maxRetries = 2;
      let profileCreated = false;
      
      while (!profileCreated && retryCount < maxRetries) {
        try {
          // First save the profile
          await createUserProfile({ 
            name, 
            email, 
            role, 
            club_name: clubName 
          });
          profileCreated = true;
        } catch (profileError) {
          console.log(`Profile creation attempt ${retryCount + 1} failed:`, profileError);
          retryCount++;
          
          if (retryCount >= maxRetries) {
            throw profileError; // Re-throw if we've exhausted retries
          }
          
          // Wait a bit before retrying
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // Navigate immediately after profile creation
      router.push('/subscription')
      
      // If auto-save is enabled and a club is selected, save all sessions in the background
      if (autoSaveSessions && clubName !== 'None') {
        saveAllClubSessions(clubName);
      }
      
      // Handle club starring in the background
      if (clubName !== 'None') {
        // Use setTimeout to move this to the next event loop cycle
        setTimeout(async () => {
          try {
            console.log('Adding club to starred clubs (background):', clubName)
            
            // Get current starred clubs from AsyncStorage directly
            const storedClubs = await AsyncStorage.getItem('starredClubs')
            let starredClubs: string[] = []
            
            if (storedClubs) {
              try {
                starredClubs = JSON.parse(storedClubs)
              } catch (parseError) {
                console.error('Error parsing stored clubs:', parseError)
              }
            }
            
            // Add the club if not already starred
            if (!starredClubs.includes(clubName)) {
              starredClubs.push(clubName)
              
              // Save back to AsyncStorage
              await AsyncStorage.setItem('starredClubs', JSON.stringify(starredClubs))
              console.log('Club added to starred clubs successfully (background)')
            }
          } catch (error) {
            console.error('Error adding club to starred clubs (background):', error)
          }
        }, 0);
      }
    } catch (err) {
      console.error('Profile creation error:', err)
      setError(err instanceof Error ? err.message : 'Failed to create profile')
      setLoading(false)
    } finally {
      // Only set loading to false if there was an error
      // For successful submissions, we've already navigated away
      if (error) {
        setLoading(false)
      }
    }
  }

  const handleSkip = () => {
    router.push('/subscription')
  }

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen 
        options={{ 
          headerShown: true,
          headerTitle: '',
          headerTintColor: '#007AFF',
          headerBackTitle: 'Back',
          headerStyle: {
            backgroundColor: colors.background,
          },
          headerShadowVisible: false,
        }} 
      />
      
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { 
            paddingHorizontal: 20,
          }
        ]}
      >
        <View style={styles.contentContainer}>
          <ThemedText style={[styles.title, { color: colors.text }]}>
            My Profile
          </ThemedText>
          
          {error && (
            <ThemedText style={styles.error}>{error}</ThemedText>
          )}

          <View style={[styles.formContainer]}>
            <View style={styles.inputContainer}>
              <ThemedText style={styles.label}>Name</ThemedText>
              <TextInput
                style={[styles.input, { 
                  borderColor: colors.border,
                  color: colors.text,
                  backgroundColor: colors.input
                }]}
                value={name}
                onChangeText={setName}
                placeholder="Enter your name"
                placeholderTextColor={colors.text + '80'}
                autoCapitalize="words"
              />
            </View>

            <View style={styles.inputContainer}>
              <ThemedText style={styles.label}>Email</ThemedText>
              <TextInput
                style={[styles.input, { 
                  borderColor: colors.border,
                  color: colors.text,
                  backgroundColor: colors.input
                }]}
                value={email}
                onChangeText={setEmail}
                placeholder="Enter your email"
                placeholderTextColor={colors.text + '80'}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.inputContainer}>
              <ThemedText style={styles.label}>Role</ThemedText>
              <Pressable
                style={({ pressed }) => [
                  styles.roleButton,
                  { 
                    backgroundColor: colors.input,
                    borderColor: colors.border,
                    opacity: pressed ? 0.8 : 1
                  }
                ]}
                onPress={() => setShowRolePicker(true)}
              >
                <ThemedText style={[
                  styles.roleText,
                  { color: colors.text }
                ]}>
                  {role}
                </ThemedText>
              </Pressable>
            </View>

            <View style={styles.inputContainer}>
              <ThemedText style={styles.label}>Club Name</ThemedText>
              <Pressable
                style={({ pressed }) => [
                  styles.roleButton,
                  { 
                    backgroundColor: colors.input,
                    borderColor: colors.border,
                    opacity: pressed ? 0.8 : 1
                  }
                ]}
                onPress={() => setShowClubPicker(true)}
              >
                <ThemedText style={[
                  styles.roleText,
                  { color: colors.text }
                ]}>
                  {clubName}
                </ThemedText>
              </Pressable>
            </View>

            {clubName !== 'None' && (
              <View style={styles.switchContainer}>
                <View style={styles.switchTextContainer}>
                  <ThemedText style={[styles.switchLabel, { color: colors.text }]}>
                    Auto-save all club sessions
                  </ThemedText>
                  <ThemedText style={[styles.switchDescription, { color: colors.secondaryText }]}>
                    Save all sessions with {clubName} athletes
                  </ThemedText>
                </View>
                <Switch
                  value={autoSaveSessions}
                  onValueChange={setAutoSaveSessions}
                  trackColor={{ false: '#767577', true: '#007AFF' }}
                  thumbColor={Platform.OS === 'ios' ? undefined : autoSaveSessions ? '#FFFFFF' : '#F4F3F4'}
                  ios_backgroundColor="#3e3e3e"
                />
              </View>
            )}
          </View>
          
          <Pressable 
            onPress={handleSkip}
            style={styles.skipButton}
          >
            <ThemedText 
              style={[
                styles.skipText, 
                { color: colors.secondaryText }
              ]}
            >
              I Don't Want To Share My Info
            </ThemedText>
          </Pressable>
        </View>
      </ScrollView>

      <View style={[
        styles.buttonWrapper,
        { 
          paddingBottom: insets.bottom + 20,
          backgroundColor: colors.background 
        }
      ]}>
        <ThemedButton
          onPress={handleSubmit}
          disabled={loading}
          style={styles.button}
        >
          Continue
        </ThemedButton>
      </View>

      <Modal
        visible={showRolePicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRolePicker(false)}
      >
        <Pressable 
          style={styles.modalOverlay}
          onPress={() => setShowRolePicker(false)}
        >
          <View 
            style={[
              styles.modalContent, 
              { 
                backgroundColor: colors.input,
                paddingBottom: insets.bottom + 20
              }
            ]}
          >
            {['Athlete', 'Coach', 'Spectator', 'Official', 'Vendor', 'Media'].map((option) => (
              <Pressable
                key={option}
                style={({ pressed }) => [
                  styles.roleOption,
                  {
                    backgroundColor: pressed ? colors.border : 'transparent',
                    borderBottomColor: colors.border,
                  }
                ]}
                onPress={() => {
                  setRole(option as typeof role)
                  setShowRolePicker(false)
                }}
              >
                <ThemedText 
                  style={[
                    styles.roleOptionText,
                    { color: option === role ? '#007AFF' : colors.text }
                  ]}
                >
                  {option}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={showClubPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowClubPicker(false)}
      >
        <Pressable 
          style={styles.modalOverlay}
          onPress={() => setShowClubPicker(false)}
        >
          <View 
            style={[
              styles.modalContent, 
              { 
                backgroundColor: colors.input,
                paddingBottom: insets.bottom + 20,
                maxHeight: '70%'
              }
            ]}
          >
            <ScrollView>
              {clubOptions.map((club) => (
                <Pressable
                  key={club}
                  style={({ pressed }) => [
                    styles.roleOption,
                    {
                      backgroundColor: pressed ? colors.border : 'transparent',
                      borderBottomColor: colors.border,
                    }
                  ]}
                  onPress={() => {
                    setClubName(club)
                    setShowClubPicker(false)
                  }}
                >
                  <ThemedText 
                    style={[
                      styles.roleOptionText,
                      { color: club === clubName ? '#007AFF' : colors.text }
                    ]}
                  >
                    {club}
                  </ThemedText>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 40,
  },
  formContainer: {
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
  },
  inputContainer: {
    marginBottom: 16,
  },
  label: {
    fontSize: 16,
    marginBottom: 8,
    fontWeight: '500',
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
  },
  pickerContainer: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: Platform.OS === 'ios' ? 'transparent' : undefined,
  },
  picker: {
    height: Platform.OS === 'ios' ? 180 : 50,
    width: '100%',
    marginTop: Platform.OS === 'ios' ? -8 : 0,
    marginBottom: Platform.OS === 'ios' ? -8 : 0,
  },
  buttonWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  button: {
    marginTop: 20,
  },
  error: {
    color: 'red',
    marginBottom: 20,
    textAlign: 'center',
  },
  skipButton: {
    alignItems: 'center',
    padding: 10,
  },
  skipText: {
    fontSize: 15,
    textDecorationLine: 'underline',
  },
  roleButton: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 50,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  roleText: {
    fontSize: 16,
    lineHeight: 24,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  roleOption: {
    padding: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roleOptionText: {
    fontSize: 18,
    lineHeight: 22,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  successModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  successModalContent: {
    padding: 20,
    borderRadius: 12,
    minWidth: 200,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  successModalText: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  switchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  switchTextContainer: {
    flex: 1,
    marginRight: 16,
  },
  switchLabel: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  switchDescription: {
    fontSize: 14,
  },
}) 