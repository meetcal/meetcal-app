import { StyleSheet, View, TextInput, ScrollView, ActivityIndicator, Modal } from 'react-native'
import { useState, useEffect } from 'react'
import { Stack, router } from 'expo-router'
import { ThemedText } from '@/components/ThemedText'
import { ThemedView } from '@/components/ThemedView'
import { ThemedButton } from '@/components/ui/ThemedButton'
import { useTheme } from '@/contexts/ThemeContext'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { sendFeedback } from '../api/feedback'
import { supabase } from '@/lib/supabase'

export default function FeedbackScreen() {
  const { currentTheme } = useTheme()
  const insets = useSafeAreaInsets()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)

  const colors = {
    background: currentTheme === 'dark' ? '#0A1A2F' : '#F0F7FF',
    card: currentTheme === 'dark' ? '#0A1A2F' : '#F0F7FF',
    input: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
  }

  // Load user profile data from Supabase
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
        }
      } catch (error) {
        console.error('Error loading profile:', error)
      } finally {
        setInitialLoading(false)
      }
    }

    loadProfile()
  }, [])

  const handleSubmit = async () => {
    if (!name || !email || !description) {
      setError('Please fill in all fields')
      return
    }

    setLoading(true)
    setError(null)

    try {
      await sendFeedback({ name, email, description })
      setShowSuccessModal(true)
      setTimeout(() => {
        setShowSuccessModal(false)
        router.back()
      }, 1500)
    } catch (err) {
      console.error('Feedback submission error:', err)
      setError(err instanceof Error ? err.message : 'Failed to submit feedback')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen 
        options={{
          headerShown: true,
          headerTitle: 'Submit Feedback',
          headerBackTitle: 'Back',
          headerTintColor: '#007AFF',
          headerTitleStyle: {
            color: colors.text,
          },
          headerStyle: {
            backgroundColor: colors.background,
          },
          headerShadowVisible: false,
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          animation: 'slide_from_right',
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
              { paddingHorizontal: 20 }
            ]}
          >
            {error && (
              <ThemedText style={styles.error}>{error}</ThemedText>
            )}

            <View style={styles.formContainer}>
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
                <ThemedText style={styles.label}>Description</ThemedText>
                <TextInput
                  style={[styles.textArea, { 
                    borderColor: colors.border,
                    color: colors.text,
                    backgroundColor: colors.input
                  }]}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Describe your feedback"
                  placeholderTextColor={colors.text + '80'}
                  multiline
                  numberOfLines={6}
                  textAlignVertical="top"
                />
              </View>
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
              {loading ? 'Submitting...' : 'Submit Feedback'}
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
              Feedback Submitted Successfully
            </ThemedText>
          </View>
        </View>
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
    paddingTop: 20,
    paddingBottom: 100,
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
  textArea: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    minHeight: 120,
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