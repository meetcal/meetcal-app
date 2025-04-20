import * as React from 'react'
import { Text, TextInput, TouchableOpacity, View, StyleSheet, Platform, Modal, Pressable, ScrollView, Alert } from 'react-native'
import { useSignUp } from '@clerk/clerk-expo'
import { Link, useRouter, Stack } from 'expo-router'
import { IconSymbol } from '@/components/ui/IconSymbol'
import { supabase } from '@/lib/supabase'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/contexts/ThemeContext'
import Purchases from 'react-native-purchases'
import { cacheAuthState } from '@/lib/authCache'

export default function SignUpScreen() {
  const { isLoaded, signUp, setActive } = useSignUp()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { currentTheme } = useTheme()

  // Define theme colors to match other screens
  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
    link: '#007AFF',
    error: '#FF3B30',
  }

  const [emailAddress, setEmailAddress] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [firstName, setFirstName] = React.useState('')
  const [lastName, setLastName] = React.useState('')
  const [role, setRole] = React.useState('Athlete')
  const [pendingVerification, setPendingVerification] = React.useState(false)
  const [code, setCode] = React.useState('')
  const [isRoleModalVisible, setIsRoleModalVisible] = React.useState(false)
  const [errors, setErrors] = React.useState({
    firstName: '',
    lastName: '',
    emailAddress: '',
    password: '',
  })

  const validateFields = () => {
    let isValid = true
    const newErrors = {
      firstName: '',
      lastName: '',
      emailAddress: '',
      password: '',
    }

    if (!firstName.trim()) {
      newErrors.firstName = 'First name is required'
      isValid = false
    }

    if (!lastName.trim()) {
      newErrors.lastName = 'Last name is required'
      isValid = false
    }

    if (!emailAddress.trim()) {
      newErrors.emailAddress = 'Email is required'
      isValid = false
    } else if (!/\S+@\S+\.\S+/.test(emailAddress)) {
      newErrors.emailAddress = 'Please enter a valid email'
      isValid = false
    }

    if (!password.trim()) {
      newErrors.password = 'Password is required'
      isValid = false
    } else if (password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters'
      isValid = false
    }

    setErrors(newErrors)
    return isValid
  }

  // Handle submission of sign-up form
  const onSignUpPress = async () => {
    if (!isLoaded) return

    if (!validateFields()) {
      return
    }

    // Start sign-up process using email and password provided
    try {
      // Create the user in Clerk with all information
      await signUp.create({
        emailAddress,
        password,
        firstName,
        lastName,
      })

      // Send user an email with verification code
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' })

      // Set 'pendingVerification' to true to display second form
      // and capture OTP code
      setPendingVerification(true)
    } catch (err: any) {
      console.error(JSON.stringify(err, null, 2))
      Alert.alert(
        'Sign Up Error',
        err.errors?.[0]?.message || 'An error occurred during sign up'
      )
    }
  }

  // Handle submission of verification form
  const onVerifyPress = async () => {
    if (!isLoaded) return

    try {
      const signUpAttempt = await signUp.attemptEmailAddressVerification({
        code,
      })

      if (signUpAttempt.status === 'complete' && 
          signUpAttempt.createdSessionId && 
          signUpAttempt.createdUserId) {
        await setActive({ session: signUpAttempt.createdSessionId })
        
        // Cache the auth state
        await cacheAuthState(true)
        
        // Sync user with RevenueCat
        try {
          await Purchases.setEmail(emailAddress);
          await Purchases.logIn(signUpAttempt.createdUserId);
        } catch (error) {
          console.error('Error syncing with RevenueCat:', error);
          // Continue with navigation even if RevenueCat sync fails
        }

        router.replace('/schedule')
      } else {
        console.error(JSON.stringify(signUpAttempt, null, 2))
      }
    } catch (err) {
      console.error(JSON.stringify(err, null, 2))
    }
  }

  const roleOptions = ['Athlete', 'Coach', 'Spectator', 'Official', 'Vendor', 'Media']

  if (pendingVerification) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen
          options={{
            headerTitle: "Verify Email",
            headerLeft: () => (
              <TouchableOpacity 
                onPress={() => router.back()}
                style={styles.backButton}
              >
                <IconSymbol
                  name={Platform.OS === 'ios' ? 'chevron.left' : 'arrow-back'}
                  size={24}
                  color={colors.link}
                />
              </TouchableOpacity>
            ),
            headerStyle: {
              backgroundColor: colors.card,
            },
            headerShadowVisible: false,
            headerTintColor: colors.text,
          }}
        />
        <View style={[styles.content, { backgroundColor: colors.background }]}>
          <Text style={[styles.title, { color: colors.text }]}>Verify your email</Text>
          <TextInput
            style={[styles.input, { 
              backgroundColor: colors.card,
              borderColor: colors.border,
              color: colors.text,
            }]}
            value={code}
            placeholder="Enter your verification code"
            placeholderTextColor={colors.secondaryText}
            onChangeText={(code) => setCode(code)}
          />
          <TouchableOpacity style={styles.button} onPress={onVerifyPress}>
            <Text style={styles.buttonText}>Verify</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerTitle: "Create Your Account",
          headerLeft: () => (
            <TouchableOpacity 
              onPress={() => router.back()}
              style={styles.backButton}
            >
              <IconSymbol
                name={Platform.OS === 'ios' ? 'chevron.left' : 'arrow-back'}
                size={24}
                color={colors.link}
              />
            </TouchableOpacity>
          ),
          headerStyle: {
            backgroundColor: colors.card,
          },
          headerShadowVisible: false,
          headerTintColor: colors.text,
        }}
      />
      <View style={[styles.content, { backgroundColor: colors.background }]}>
        <View>
          <TextInput
            style={[
              styles.input,
              { 
                backgroundColor: colors.card,
                borderColor: errors.firstName ? colors.error : colors.border,
                color: colors.text,
              }
            ]}
            value={firstName}
            placeholder="First name"
            placeholderTextColor={colors.secondaryText}
            onChangeText={(name) => {
              setFirstName(name)
              if (errors.firstName) {
                setErrors(prev => ({ ...prev, firstName: '' }))
              }
            }}
          />
          {errors.firstName ? <Text style={[styles.errorText, { color: colors.error }]}>{errors.firstName}</Text> : null}
        </View>

        <View>
          <TextInput
            style={[
              styles.input,
              { 
                backgroundColor: colors.card,
                borderColor: errors.lastName ? colors.error : colors.border,
                color: colors.text,
              }
            ]}
            value={lastName}
            placeholder="Last name"
            placeholderTextColor={colors.secondaryText}
            onChangeText={(name) => {
              setLastName(name)
              if (errors.lastName) {
                setErrors(prev => ({ ...prev, lastName: '' }))
              }
            }}
          />
          {errors.lastName ? <Text style={[styles.errorText, { color: colors.error }]}>{errors.lastName}</Text> : null}
        </View>

        <View>
          <TextInput
            style={[
              styles.input,
              { 
                backgroundColor: colors.card,
                borderColor: errors.emailAddress ? colors.error : colors.border,
                color: colors.text,
              }
            ]}
            autoCapitalize="none"
            value={emailAddress}
            placeholder="Enter email"
            placeholderTextColor={colors.secondaryText}
            onChangeText={(email) => {
              setEmailAddress(email)
              if (errors.emailAddress) {
                setErrors(prev => ({ ...prev, emailAddress: '' }))
              }
            }}
          />
          {errors.emailAddress ? <Text style={[styles.errorText, { color: colors.error }]}>{errors.emailAddress}</Text> : null}
        </View>

        <View>
          <TextInput
            style={[
              styles.input,
              { 
                backgroundColor: colors.card,
                borderColor: errors.password ? colors.error : colors.border,
                color: colors.text,
              }
            ]}
            value={password}
            placeholder="Enter password"
            placeholderTextColor={colors.secondaryText}
            secureTextEntry={true}
            onChangeText={(password) => {
              setPassword(password)
              if (errors.password) {
                setErrors(prev => ({ ...prev, password: '' }))
              }
            }}
          />
          {errors.password ? <Text style={[styles.errorText, { color: colors.error }]}>{errors.password}</Text> : null}
        </View>
        
        <Pressable
          style={[
            styles.roleSelector,
            { 
              backgroundColor: colors.card,
              borderColor: colors.border,
            }
          ]}
          onPress={() => setIsRoleModalVisible(true)}
        >
          <View style={styles.roleSelectorContent}>
            <Text style={[styles.roleSelectorLabel, { color: colors.secondaryText }]}>Role</Text>
            <Text style={[styles.roleSelectorValue, { color: colors.text }]}>{role}</Text>
          </View>
          <IconSymbol
            name={Platform.OS === 'ios' ? 'chevron.right' : 'chevron-forward'}
            size={20}
            color={colors.link}
          />
        </Pressable>

        <TouchableOpacity style={styles.button} onPress={onSignUpPress}>
          <Text style={styles.buttonText}>Continue</Text>
        </TouchableOpacity>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.secondaryText }]}>Already have an account?</Text>
          <Link href="/sign-in" style={styles.link}>
            <Text style={[styles.linkText, { color: colors.link }]}>Sign in</Text>
          </Link>
        </View>
      </View>

      {/* Role Selection Modal */}
      <Modal
        visible={isRoleModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIsRoleModalVisible(false)}
      >
        <Pressable 
          style={[
            styles.modalOverlay,
            { backgroundColor: currentTheme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.4)' }
          ]}
          onPress={() => setIsRoleModalVisible(false)}
        >
          <View style={[
            styles.modalContent,
            { 
              backgroundColor: colors.card,
              paddingBottom: Math.max(20, insets.bottom + 20) 
            }
          ]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Select Role</Text>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setIsRoleModalVisible(false)}
              >
                <IconSymbol 
                  name={Platform.OS === 'ios' ? 'xmark' : 'close'}
                  size={20} 
                  color={colors.secondaryText}
                />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScrollView}>
              {roleOptions.map((option) => (
                <Pressable
                  key={option}
                  style={[
                    styles.roleOption,
                    { borderBottomColor: colors.border }
                  ]}
                  onPress={() => {
                    setRole(option)
                    setIsRoleModalVisible(false)
                  }}
                >
                  <Text style={[
                    styles.roleOptionText,
                    { color: colors.text },
                    option === role && { color: colors.link }
                  ]}>
                    {option}
                  </Text>
                  {option === role && (
                    <IconSymbol name="checkmark" size={16} color={colors.link} />
                  )}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  backButton: {
    padding: 8,
    marginLeft: Platform.OS === 'ios' ? -8 : 0,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    padding: 15,
    borderRadius: 8,
    marginBottom: 8,
    fontSize: 16,
  },
  errorText: {
    fontSize: 12,
    marginBottom: 8,
    marginLeft: 4,
  },
  roleSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    padding: 15,
    borderRadius: 8,
    marginBottom: 15,
  },
  roleSelectorContent: {
    flex: 1,
  },
  roleSelectorLabel: {
    fontSize: 14,
    marginBottom: 4,
  },
  roleSelectorValue: {
    fontSize: 16,
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
    gap: 5,
  },
  footerText: {
    fontSize: 16,
  },
  link: {
    marginLeft: 5,
  },
  linkText: {
    fontSize: 16,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
  },
  modalScrollView: {
    paddingBottom: 20,
  },
});