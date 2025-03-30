import { StyleSheet, View, TextInput, ScrollView, ActivityIndicator, Modal, Pressable, TouchableOpacity } from 'react-native'
import { useState, useEffect } from 'react'
import { Stack, router } from 'expo-router'
import { ThemedText } from '@/components/ThemedText'
import { ThemedView } from '@/components/ThemedView'
import { ThemedButton } from '@/components/ui/ThemedButton'
import { useTheme } from '@/contexts/ThemeContext'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { sendFeedback } from '../api/feedback'
import { supabase } from '@/lib/supabase'
import type { UserProfile } from '@/lib/profile'
import { IconSymbol } from '@/components/ui/IconSymbol'
import { Platform } from 'react-native'
import { useUser } from '@clerk/clerk-expo'

// Define the shape of user metadata
interface UserMetadata {
  role?: UserProfile['role'];
}

export default function FeedbackScreen() {
  const { currentTheme } = useTheme()
  const insets = useSafeAreaInsets()
  const { user, isLoaded: isUserLoaded } = useUser()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserProfile['role']>('Athlete')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [showRolePicker, setShowRolePicker] = useState(false)

  // Auto-fill user information when available
  useEffect(() => {
    if (isUserLoaded && user) {
      // Set name from user's full name or first + last name
      const fullName = user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim()
      setName(fullName)
      
      // Set email from user's primary email
      if (user.primaryEmailAddress) {
        setEmail(user.primaryEmailAddress.emailAddress)
      }
      
      // Set role from user's public metadata if available
      const metadata = user.publicMetadata as UserMetadata
      if (metadata.role) {
        setRole(metadata.role)
      }
    }
  }, [isUserLoaded, user])

  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
    link: '#007AFF',
    input: currentTheme === 'dark' ? '#2C2C2E' : '#F6F6F7',
  }

  const handleSubmit = async () => {
    if (!name || !email || !description) {
      setError('Please fill in all fields')
      return
    }

    setLoading(true)
    setError(null)

    try {
      await sendFeedback({ name, email, role, description })
      setShowSuccessModal(true)
      setTimeout(() => {
        setShowSuccessModal(false)
        router.back()
      }, 1000)
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
          headerTintColor: colors.link,
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

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { 
            paddingHorizontal: 20,
            paddingBottom: Math.max(80, insets.bottom + 60)
          }
        ]}
        showsVerticalScrollIndicator={false}
      >
        {error && (
          <ThemedText style={styles.error}>{error}</ThemedText>
        )}

        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.inputContainer}>
            <ThemedText style={[styles.label, { color: colors.secondaryText }]}>Name</ThemedText>
            <TextInput
              style={[
                styles.input, 
                { 
                  borderColor: colors.border,
                  color: colors.text,
                  backgroundColor: colors.input,
                  opacity: isUserLoaded && user ? 0.7 : 1
                }
              ]}
              value={name}
              onChangeText={setName}
              placeholder="Enter your name"
              placeholderTextColor={colors.secondaryText}
              editable={!(isUserLoaded && user)}
            />
          </View>

          <View style={styles.inputContainer}>
            <ThemedText style={[styles.label, { color: colors.secondaryText }]}>Email</ThemedText>
            <TextInput
              style={[
                styles.input, 
                { 
                  borderColor: colors.border,
                  color: colors.text,
                  backgroundColor: colors.input,
                  opacity: isUserLoaded && user ? 0.7 : 1
                }
              ]}
              value={email}
              onChangeText={setEmail}
              placeholder="Enter your email"
              placeholderTextColor={colors.secondaryText}
              keyboardType="email-address"
              autoCapitalize="none"
              editable={!(isUserLoaded && user)}
            />
          </View>

          <View style={styles.inputContainer}>
            <ThemedText style={[styles.label, { color: colors.secondaryText }]}>Role</ThemedText>
            <Pressable
              style={({ pressed }) => [
                styles.roleButton,
                { 
                  backgroundColor: colors.input,
                  borderColor: colors.border,
                  opacity: (isUserLoaded && (user?.publicMetadata as UserMetadata)?.role) ? 0.7 : pressed ? 0.8 : 1
                }
              ]}
              onPress={() => setShowRolePicker(true)}
              disabled={isUserLoaded && !!(user?.publicMetadata as UserMetadata)?.role}
            >
              <View style={styles.roleButtonContent}>
                <ThemedText style={[styles.roleText, { color: colors.text }]}>
                  {role}
                </ThemedText>
                {!(isUserLoaded && (user?.publicMetadata as UserMetadata)?.role) && (
                  <IconSymbol
                    name={Platform.OS === 'ios' ? 'chevron.right' : 'chevron-forward'}
                    size={20}
                    color={colors.link}
                  />
                )}
              </View>
            </Pressable>
            {isUserLoaded && (user?.publicMetadata as UserMetadata)?.role && (
              <ThemedText style={[styles.autoFilledText, { color: colors.secondaryText }]}>
                Auto-filled from your profile
              </ThemedText>
            )}
          </View>

          <View style={styles.inputContainer}>
            <ThemedText style={[styles.label, { color: colors.secondaryText }]}>Description</ThemedText>
            <TextInput
              style={[styles.textArea, { 
                borderColor: colors.border,
                color: colors.text,
                backgroundColor: colors.input
              }]}
              value={description}
              onChangeText={setDescription}
              placeholder="Describe your feedback"
              placeholderTextColor={colors.secondaryText}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
            />
          </View>
        </View>

        <ThemedButton
          onPress={handleSubmit}
          disabled={loading}
          style={styles.button}
        >
          {loading ? 'Submitting...' : 'Submit Feedback'}
        </ThemedButton>
      </ScrollView>

      <Modal
        visible={showSuccessModal}
        transparent
        animationType="fade"
      >
        <View style={[
          styles.successModalOverlay,
          { backgroundColor: currentTheme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.4)' }
        ]}>
          <View style={[styles.successModalContent, { backgroundColor: colors.card }]}>
            <ThemedText style={[styles.successModalText, { color: colors.text }]}>
              Feedback Submitted Successfully
            </ThemedText>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showRolePicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRolePicker(false)}
      >
        <Pressable 
          style={[
            styles.modalOverlay,
            { backgroundColor: currentTheme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.4)' }
          ]}
          onPress={() => setShowRolePicker(false)}
        >
          <View 
            style={[
              styles.modalContent, 
              { 
                backgroundColor: colors.card,
                paddingBottom: insets.bottom + 20
              }
            ]}
          >
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <ThemedText style={[styles.modalTitle, { color: colors.text }]}>
                Select Role
              </ThemedText>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setShowRolePicker(false)}
              >
                <IconSymbol 
                  name={Platform.OS === 'ios' ? 'xmark' : 'close'}
                  size={20} 
                  color={colors.secondaryText} 
                />
              </TouchableOpacity>
            </View>

            {['Athlete', 'Coach', 'Spectator', 'Official', 'Vendor', 'Media'].map((option) => (
              <Pressable
                key={option}
                style={({ pressed }) => [
                  styles.roleOption,
                  {
                    backgroundColor: pressed ? colors.pressed : 'transparent',
                    borderBottomColor: colors.border,
                  }
                ]}
                onPress={() => {
                  setRole(option as UserProfile['role']);
                  setShowRolePicker(false);
                }}
              >
                <ThemedText 
                  style={[
                    styles.roleOptionText,
                    { color: option === role ? colors.link : colors.text }
                  ]}
                >
                  {option}
                </ThemedText>
                {option === role && (
                  <IconSymbol name="checkmark" size={16} color={colors.link} />
                )}
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
    paddingTop: 20,
  },
  card: {
    borderRadius: 12,
    marginBottom: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
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
  button: {
    marginTop: 20,
  },
  error: {
    color: '#FF3B30',
    marginBottom: 20,
    textAlign: 'center',
  },
  roleButton: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 50,
    justifyContent: 'center',
  },
  roleButtonContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  roleText: {
    fontSize: 16,
    lineHeight: 24,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  modalHeader: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  closeButton: {
    position: 'absolute',
    right: 16,
    padding: 4,
  },
  roleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  roleOptionText: {
    fontSize: 17,
    lineHeight: 22,
  },
  successModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
  autoFilledText: {
    fontSize: 13,
    marginTop: 4,
    fontStyle: 'italic',
  },
}) 