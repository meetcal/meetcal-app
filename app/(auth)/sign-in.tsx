import { useSignIn } from '@clerk/clerk-expo'
import { Link, useRouter, Stack, useLocalSearchParams } from 'expo-router'
import { Text, TextInput, TouchableOpacity, View, StyleSheet, Platform, Image, Dimensions, Modal, Pressable, ScrollView, Alert } from 'react-native'
import React, { useCallback, useEffect } from 'react'
import * as WebBrowser from 'expo-web-browser'
import * as AuthSession from 'expo-auth-session'
import { useSSO } from '@clerk/clerk-expo'
import { IconSymbol } from '@/components/ui/IconSymbol'
import { useTheme } from '@/contexts/ThemeContext'
import { useSubscription } from '@/contexts/SubscriptionContext'
import Purchases from 'react-native-purchases'
import { cacheAuthState } from '@/lib/authCache'

// Warm up the browser for better performance
export const useWarmUpBrowser = () => {
  useEffect(() => {
    void WebBrowser.warmUpAsync()
    return () => {
      void WebBrowser.coolDownAsync()
    }
  }, [])
}

WebBrowser.maybeCompleteAuthSession()

export default function SignInScreen() {
  const { signIn, setActive, isLoaded } = useSignIn()
  const { startSSOFlow } = useSSO()
  const router = useRouter()
  const { currentTheme } = useTheme()
  const { from } = useLocalSearchParams<{ from?: string }>()
  const isFromInfo = from === 'info'
  const { isSubscribed } = useSubscription()

  useWarmUpBrowser()

  const [emailAddress, setEmailAddress] = React.useState('')
  const [password, setPassword] = React.useState('')

  // Define theme colors to match other screens
  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
    link: '#007AFF',
  }

  const handlePostSignIn = useCallback(() => {
    if (!isSubscribed) {
      router.replace('/(screens)/paywall');
    } else if (from === 'info') {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  }, [from, isSubscribed, router]);

  // Handle the submission of the sign-in form
  const onSignInPress = async () => {
    if (!isLoaded) return

    try {
      const signInAttempt = await signIn.create({
        identifier: emailAddress,
        password,
      })

      if (signInAttempt.status === 'complete' && signInAttempt.createdSessionId) {
        await setActive({ session: signInAttempt.createdSessionId })
        
        // Cache the auth state
        await cacheAuthState(true)
        
        // Sync user with RevenueCat after successful sign-in
        try {
          await Purchases.setEmail(emailAddress);
          await Purchases.logIn(signInAttempt.createdSessionId);
        } catch (error) {
          console.error('Error syncing with RevenueCat:', error);
          // Continue with navigation even if RevenueCat sync fails
        }
        
        handlePostSignIn();
      } else {
        console.error(JSON.stringify(signInAttempt, null, 2))
      }
    } catch (err) {
      console.error(JSON.stringify(err, null, 2))
    }
  }

  // Handle Google OAuth
  const onGooglePress = useCallback(async () => {
    try {
      console.log('Starting Google OAuth flow...');
      const redirectUrl = AuthSession.makeRedirectUri({
        scheme: 'meetcal',
        path: 'oauth-native-callback'
      });
      console.log('Redirect URL:', redirectUrl);

      console.log('Calling startSSOFlow...');
      const result = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl,
      });
      console.log('SSO Flow Result:', JSON.stringify(result, null, 2));

      if (result.createdSessionId) {
        console.log('Session created directly:', result.createdSessionId);
        await result.setActive!({ session: result.createdSessionId });
        handlePostSignIn();
      } else if (result.signUp) {
        console.log('Sign up flow initiated:', result.signUp.status);
        const signUp = result.signUp;
        
        try {
          console.log('Attempting to complete sign up...');
          
          // First, update the sign-up with required fields
          await signUp.update({
            emailAddress: signUp.emailAddress || '',
            firstName: signUp.firstName || '',
            lastName: signUp.lastName || '',
            password: Math.random().toString(36).slice(-8), // Generate a random password
            legalAccepted: true
          });

          // Then complete the sign-up
          const completeSignUp = await signUp.create({
            strategy: 'oauth_google',
            redirectUrl,
            transfer: true,
          });
          
          console.log('Sign up completion result:', JSON.stringify(completeSignUp, null, 2));
          
          if (completeSignUp.createdSessionId) {
            console.log('Session created after sign up:', completeSignUp.createdSessionId);
            await result.setActive!({ session: completeSignUp.createdSessionId });
            handlePostSignIn();
          } else {
            console.log('No session created after sign up completion');
            // If sign up didn't create a session, try to sign in
            if (result.signIn && signUp.emailAddress) {
              const signInAttempt = await result.signIn.create({
                identifier: signUp.emailAddress,
                strategy: 'oauth_google',
                redirectUrl,
              });
              
              if (signInAttempt.createdSessionId) {
                await result.setActive!({ session: signInAttempt.createdSessionId });
                handlePostSignIn();
              }
            }
          }
        } catch (signUpErr) {
          console.error('Sign up error:', JSON.stringify(signUpErr, null, 2));
        }
      } else if (result.signIn) {
        console.log('Sign in flow initiated:', result.signIn.status);
        const signIn = result.signIn;
        
        try {
          const signInAttempt = await signIn.create({
            strategy: 'oauth_google',
            redirectUrl,
          });
          
          if (signInAttempt.createdSessionId) {
            console.log('Session created from sign in:', signInAttempt.createdSessionId);
            await result.setActive!({ session: signInAttempt.createdSessionId });
            handlePostSignIn();
          } else {
            console.log('No session created from sign in');
          }
        } catch (signInErr) {
          console.error('Sign in error:', JSON.stringify(signInErr, null, 2));
        }
      } else {
        console.log('Unexpected flow state:', JSON.stringify(result, null, 2));
      }
    } catch (err) {
      console.error('OAuth error:', JSON.stringify(err, null, 2));
    }
  }, [handlePostSignIn]);

  // Handle Apple OAuth
  const onApplePress = useCallback(async () => {
    try {
      console.log('Starting Apple OAuth flow...');
      const redirectUrl = AuthSession.makeRedirectUri({
        scheme: 'meetcal',
        path: 'oauth-native-callback'
      });
      console.log('Redirect URL:', redirectUrl);

      console.log('Calling startSSOFlow...');
      const result = await startSSOFlow({
        strategy: 'oauth_apple',
        redirectUrl,
      });
      console.log('SSO Flow Result:', JSON.stringify(result, null, 2));

      if (result.createdSessionId) {
        console.log('Session created directly:', result.createdSessionId);
        await result.setActive!({ session: result.createdSessionId });
        handlePostSignIn();
      } else if (result.signUp) {
        console.log('Sign up flow initiated:', result.signUp.status);
        const signUp = result.signUp;
        
        try {
          console.log('Attempting to complete sign up...');
          
          // First, update the sign-up with required fields
          await signUp.update({
            emailAddress: signUp.emailAddress || '',
            firstName: signUp.firstName || '',
            lastName: signUp.lastName || '',
            password: Math.random().toString(36).slice(-8), // Generate a random password
            legalAccepted: true
          });

          // Then complete the sign-up
          const completeSignUp = await signUp.create({
            strategy: 'oauth_apple',
            redirectUrl,
            transfer: true,
          });
          
          console.log('Sign up completion result:', JSON.stringify(completeSignUp, null, 2));
          
          if (completeSignUp.createdSessionId) {
            console.log('Session created after sign up:', completeSignUp.createdSessionId);
            await result.setActive!({ session: completeSignUp.createdSessionId });
            handlePostSignIn();
          } else {
            console.log('No session created after sign up completion');
            // If sign up didn't create a session, try to sign in
            if (result.signIn && signUp.emailAddress) {
              const signInAttempt = await result.signIn.create({
                identifier: signUp.emailAddress,
                strategy: 'oauth_apple',
                redirectUrl,
              });
              
              if (signInAttempt.createdSessionId) {
                await result.setActive!({ session: signInAttempt.createdSessionId });
                handlePostSignIn();
              }
            }
          }
        } catch (signUpErr) {
          console.error('Sign up error:', JSON.stringify(signUpErr, null, 2));
        }
      } else if (result.signIn) {
        console.log('Sign in flow initiated:', result.signIn.status);
        const signIn = result.signIn;
        
        try {
          const signInAttempt = await signIn.create({
            strategy: 'oauth_apple',
            redirectUrl,
          });
          
          if (signInAttempt.createdSessionId) {
            console.log('Session created from sign in:', signInAttempt.createdSessionId);
            await result.setActive!({ session: signInAttempt.createdSessionId });
            handlePostSignIn();
          } else {
            console.log('No session created from sign in');
          }
        } catch (signInErr) {
          console.error('Sign in error:', JSON.stringify(signInErr, null, 2));
        }
      } else {
        console.log('Unexpected flow state:', JSON.stringify(result, null, 2));
      }
    } catch (err) {
      console.error('OAuth error:', JSON.stringify(err, null, 2));
    }
  }, [handlePostSignIn]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerTitle: "",
          headerLeft: isFromInfo ? () => (
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
          ) : undefined,
          headerStyle: {
            backgroundColor: colors.background,
          },
          headerShadowVisible: false,
          headerTintColor: colors.text,
        }}
      />
      <View style={[styles.content, { backgroundColor: colors.background }]}>
        <View style={styles.titleContainer}>
          <Image 
            source={require('@/assets/images/MeetCal-no-bg.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={[styles.title, { color: colors.text }]}>Welcome to MeetCal</Text>
          <Text style={[styles.subtitle, { color: colors.secondaryText }]}>Please Sign In to Continue</Text>
        </View>

        <TouchableOpacity
          style={[styles.button, styles.googleButton, { 
            backgroundColor: currentTheme === 'dark' ? '#FFFFFF' : colors.card,
            borderColor: colors.border 
          }]}
          onPress={onGooglePress}
        >
          <View style={styles.googleIconContainer}>
            <Image
              source={require('@/assets/images/ios_light_sq_na.png')}
              style={styles.googleIcon}
            />
          </View>
          <Text style={[styles.buttonText, styles.googleButtonText, { 
            color: currentTheme === 'dark' ? '#000000' : colors.text 
          }]}>
            Continue with Google
          </Text>
        </TouchableOpacity>

        {Platform.OS === 'ios' && (
          <TouchableOpacity 
            style={[styles.button, styles.appleButton, {
              backgroundColor: currentTheme === 'dark' ? '#FFFFFF' : '#000000'
            }]} 
            onPress={onApplePress}
          >
            <View style={styles.iconContainer}>
              <IconSymbol
                name="apple.logo"
                size={22}
                color={currentTheme === 'dark' ? '#000000' : '#FFFFFF'}
              />
            </View>
            <Text style={[styles.buttonText, styles.appleButtonText, {
              color: currentTheme === 'dark' ? '#000000' : '#FFFFFF'
            }]}>
              Continue with Apple
            </Text>
          </TouchableOpacity>
        )}
      </View>
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
  input: {
    borderWidth: 1,
    padding: 15,
    borderRadius: 8,
    marginBottom: 15,
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
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    marginHorizontal: 10,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
  },
  googleIconContainer: {
    marginRight: 8,
  },
  googleIcon: {
    width: 18,
    height: 18,
  },
  googleButtonText: {
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: 0.25,
    fontFamily: Platform.OS === 'ios' ? '-apple-system' : 'sans-serif-medium',
  },
  appleButton: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  iconContainer: {
    marginRight: 8,
  },
  appleButtonText: {
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: 0.25,
    fontFamily: Platform.OS === 'ios' ? '-apple-system' : 'sans-serif-medium',
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
  titleContainer: {
    marginBottom: 32,
    alignItems: 'center',
    width: '100%',
  },
  logo: {
    width: Dimensions.get('window').width * 0.5, // 50% of screen width
    height: Dimensions.get('window').width * 0.5 * 0.5, // Maintain aspect ratio (2:1)
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
  },
});