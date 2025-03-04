import { View, TextInput, StyleSheet, ScrollView, Platform, Pressable, Modal, ActivityIndicator } from 'react-native'
import { useState, useEffect } from 'react'
import { router, Stack } from 'expo-router'
import { Picker } from '@react-native-picker/picker'
import { createUserProfile } from '@/lib/profile'
import { ThemedText } from '@/components/ThemedText'
import { ThemedView } from '@/components/ThemedView'
import { ThemedButton } from '@/components/ui/ThemedButton'
import { useTheme } from '@/contexts/ThemeContext'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { liftingResults } from '@/data/athletes'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useSavedSessions } from '@/contexts/SavedSessionsContext'

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

  // Get the correct functions/values from the context
  const { savedSessions, setSavedSessions } = useSavedSessions()

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
              
              // Update the context if needed
              if (setSavedSessions) {
                setSavedSessions({
                  ...savedSessions,
                  starredClubs
                })
              }
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
}) 