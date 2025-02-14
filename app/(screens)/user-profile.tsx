import { View, TextInput, StyleSheet, ScrollView, Platform, Pressable, Modal, ActivityIndicator } from 'react-native'
import { useState, useEffect } from 'react'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { Picker } from '@react-native-picker/picker'
import { createUserProfile, getUserProfile } from '@/lib/profile'
import { ThemedText } from '@/components/ThemedText'
import { ThemedView } from '@/components/ThemedView'
import { ThemedButton } from '@/components/ui/ThemedButton'
import { useTheme } from '@/contexts/ThemeContext'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'

export default function UserProfileScreen() {
  const { currentTheme } = useTheme()
  const insets = useSafeAreaInsets()
  const { from } = useLocalSearchParams<{ from: string }>()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'Athlete' | 'Coach' | 'Spectator'>('Athlete')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRolePicker, setShowRolePicker] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [showSuccessModal, setShowSuccessModal] = useState(false)

  const colors = {
    background: currentTheme === 'dark' ? '#0A1A2F' : '#F0F7FF',
    card: currentTheme === 'dark' ? '#0A1A2F' : '#F0F7FF',
    input: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
  }

  const roleOptions = ['Athlete', 'Coach', 'Spectator'] as const

  const selectRole = (selectedRole: typeof role) => {
    setRole(selectedRole)
    setShowRolePicker(false)
  }

  const handleSubmit = async () => {
    if (!name || !email) {
      setError('Please fill in all fields')
      return
    }

    setLoading(true)
    setError(null)

    try {
      await createUserProfile({
        name,
        email,
        role
      })

      if (from === 'info') {
        setShowSuccessModal(true)
        setTimeout(() => {
          setShowSuccessModal(false)
          router.back()
        }, 1000)
      } else {
        router.push('/subscription')
      }
    } catch (err) {
      console.error('Profile creation error:', err)
      setError(err instanceof Error ? err.message : 'Failed to create profile')
    } finally {
      setLoading(false)
    }
  }

  const handleSkip = () => {
    if (from === 'info') {
      router.back()
    } else {
      router.push('/subscription')
    }
  }

  useEffect(() => {
    async function loadProfile() {
      try {
        const profiles = await supabase
          .from('user_profiles')
          .select('*')
          .limit(1)
          .single()

        if (profiles.data) {
          setName(profiles.data.name || '')
          setEmail(profiles.data.email || '')
          setRole(profiles.data.role || 'Athlete')
        }
      } catch (error) {
        console.error('Error loading profile:', error)
      } finally {
        setInitialLoading(false)
      }
    }

    loadProfile()
  }, [])

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen 
        options={{ 
          headerShown: from === 'info',
          headerTitle: '',
          headerTintColor: '#007AFF',
          headerBackTitle: 'Back',
          headerStyle: {
            backgroundColor: colors.background,
          },
          headerShadowVisible: false,
        }} 
      />
      
      {initialLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.text} />
        </View>
      ) : (
        <>
          <ScrollView 
            style={styles.scrollView}
            contentContainerStyle={[
              styles.scrollContent,
              { 
                paddingTop: from === 'info' ? 20 : insets.top + 40,
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
              {loading ? 'Saving...' : from === 'info' ? 'Save' : 'Continue'}
            </ThemedButton>
          </View>
        </>
      )}

      <Modal
        visible={showSuccessModal}
        transparent
        animationType="fade"
      >
        <View style={styles.successModalOverlay}>
          <View style={[styles.successModalContent, { backgroundColor: colors.card }]}>
            <ThemedText style={[styles.successModalText, { color: colors.text }]}>
              Profile Updated Successfully
            </ThemedText>
          </View>
        </View>
      </Modal>

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
            {roleOptions.map((option) => (
              <Pressable
                key={option}
                style={({ pressed }) => [
                  styles.roleOption,
                  {
                    backgroundColor: pressed ? colors.border : 'transparent',
                    borderBottomColor: colors.border,
                  }
                ]}
                onPress={() => selectRole(option)}
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
  contentContainer: {
    paddingTop: '15%',
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 32,
    textAlign: 'center',
    lineHeight: 38,
  },
  formContainer: {
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
  },
  inputContainer: {
    marginBottom: 20,
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