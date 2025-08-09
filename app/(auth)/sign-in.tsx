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
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  withDelay,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated'
import { LinearGradient } from 'expo-linear-gradient'

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

  // Animation values
  const logoOpacity = useSharedValue(0)
  const logoScale = useSharedValue(0.8)
  const logoTranslateY = useSharedValue(30)
  const titleOpacity = useSharedValue(0)
  const titleTranslateY = useSharedValue(20)
  const buttonsOpacity = useSharedValue(0)
  const buttonsTranslateY = useSharedValue(20)

  // Define enhanced color scheme
  const colors = {
    background: currentTheme === 'dark' ? '#0F0F0F' : '#F8F9FA',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    cardShadow: currentTheme === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.1)',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#1C1C1E',
    secondaryText: currentTheme === 'dark' ? '#A0A0A0' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
    link: '#007AFF',
    accent: '#007AFF',
    gradient: currentTheme === 'dark' 
      ? ['#0F0F0F', '#1A1A1A', '#0F0F0F']
      : ['#F8F9FA', '#FFFFFF', '#F0F2F5'],
  }

  // Animation styles
  const animatedLogoStyle = useAnimatedStyle(() => {
    return {
      opacity: logoOpacity.value,
      transform: [
        { scale: logoScale.value },
        { translateY: logoTranslateY.value },
      ],
    }
  })

  const animatedTitleStyle = useAnimatedStyle(() => {
    return {
      opacity: titleOpacity.value,
      transform: [{ translateY: titleTranslateY.value }],
    }
  })

  const animatedButtonsStyle = useAnimatedStyle(() => {
    return {
      opacity: buttonsOpacity.value,
      transform: [{ translateY: buttonsTranslateY.value }],
    }
  })

  // Start entrance animations
  useEffect(() => {
    const startAnimations = () => {
      // Logo animation
      logoOpacity.value = withTiming(1, { duration: 600 })
      logoScale.value = withSpring(1, {
        damping: 15,
        stiffness: 100,
        mass: 1,
      })
      logoTranslateY.value = withSpring(0, {
        damping: 15,
        stiffness: 100,
        mass: 1,
      })

      // Title animation
      titleOpacity.value = withDelay(200, withTiming(1, { duration: 500 }))
      titleTranslateY.value = withDelay(200, withSpring(0, {
        damping: 15,
        stiffness: 100,
        mass: 1,
      }))

      // Buttons animation
      buttonsOpacity.value = withDelay(400, withTiming(1, { duration: 500 }))
      buttonsTranslateY.value = withDelay(400, withSpring(0, {
        damping: 15,
        stiffness: 100,
        mass: 1,
      }))
    }

    startAnimations()
  }, [])

  const handlePostSignIn = useCallback(() => {
    if (!isSubscribed) {
      router.replace('/(screens)/paywall');
    } else if (from === 'info') {
      router.back();
    } else {
      router.replace('/(tabs)/schedule');
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
    <LinearGradient
      colors={colors.gradient}
      style={styles.container}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
    >
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
            backgroundColor: 'transparent',
          },
          headerShadowVisible: false,
          headerTintColor: colors.text,
          headerTransparent: true,
        }}
      />
      
      <View style={styles.content}>
        {/* Logo and Title Section */}
        <Animated.View style={[styles.titleContainer, animatedLogoStyle]}>
          <View style={styles.logoWrapper}>
            <Image 
              source={require('@/assets/images/MeetCal-no-bg.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>
        </Animated.View>

        <Animated.View style={[styles.textContainer, animatedTitleStyle]}>
          <Text style={[styles.title, { color: colors.text }]}>Welcome Back</Text>
          <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
            Sign in to access your weightlifting journey
          </Text>
        </Animated.View>

        {/* Authentication Buttons */}
        <Animated.View style={[styles.buttonsContainer, animatedButtonsStyle]}>
          <TouchableOpacity
            style={[styles.authButton, styles.googleButton, { 
              backgroundColor: colors.card,
              borderColor: colors.border,
              shadowColor: colors.cardShadow,
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
              color: colors.text 
            }]}>
              Continue with Google
            </Text>
          </TouchableOpacity>

          {Platform.OS === 'ios' && (
            <TouchableOpacity 
              style={[styles.authButton, styles.appleButton, {
                backgroundColor: colors.text,
                shadowColor: colors.cardShadow,
              }]} 
              onPress={onApplePress}
            >
              <View style={styles.iconContainer}>
                <IconSymbol
                  name="apple.logo"
                  size={22}
                  color={colors.background}
                />
              </View>
              <Text style={[styles.buttonText, styles.appleButtonText, {
                color: colors.background
              }]}>
                Continue with Apple
              </Text>
            </TouchableOpacity>
          )}
        </Animated.View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.secondaryText }]}>
            Your weightlifting meets, perfectly organized
          </Text>
        </View>
      </View>
    </LinearGradient>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 100 : 80,
    paddingBottom: 40,
    justifyContent: 'space-between',
  },
  backButton: {
    padding: 8,
    marginLeft: Platform.OS === 'ios' ? -8 : 0,
    marginTop: Platform.OS === 'ios' ? 8 : 16,
  },
  titleContainer: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logoWrapper: {
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  logo: {
    width: 140,
    height: 140,
  },
  textContainer: {
    alignItems: 'center',
    marginBottom: 48,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 18,
    textAlign: 'center',
    lineHeight: 24,
    fontWeight: '400',
    letterSpacing: 0.2,
  },
  buttonsContainer: {
    paddingHorizontal: 4,
  },
  authButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
    borderRadius: 16,
    paddingHorizontal: 20,
    marginBottom: 16,
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 6,
  },
  googleButton: {
    borderWidth: 1.5,
  },
  googleIconContainer: {
    marginRight: 12,
  },
  googleIcon: {
    width: 20,
    height: 20,
  },
  appleButton: {
    // No border for Apple button as it has a filled background
  },
  iconContainer: {
    marginRight: 12,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
    fontFamily: Platform.OS === 'ios' ? '-apple-system' : 'sans-serif-medium',
  },
  googleButtonText: {
    // Inherits from buttonText
  },
  appleButtonText: {
    // Inherits from buttonText
  },
  footer: {
    alignItems: 'center',
    marginTop: 24,
    paddingHorizontal: 20,
  },
  footerText: {
    fontSize: 15,
    textAlign: 'center',
    fontWeight: '400',
    lineHeight: 20,
    letterSpacing: 0.1,
  },
});