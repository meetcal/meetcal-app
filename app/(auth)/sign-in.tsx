import { useSignIn } from '@clerk/clerk-expo'
import { Link, useRouter, Stack } from 'expo-router'
import { Text, TextInput, TouchableOpacity, View, StyleSheet, Platform, Image } from 'react-native'
import React, { useCallback, useEffect } from 'react'
import * as WebBrowser from 'expo-web-browser'
import * as AuthSession from 'expo-auth-session'
import { useSSO } from '@clerk/clerk-expo'
import { IconSymbol } from '@/components/ui/IconSymbol'
import { useTheme } from '@/contexts/ThemeContext'

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

  const navigateToInfo = useCallback(() => {
    console.log('Attempting to navigate to info');
    router.replace('/info');
  }, [router]);

  // Handle the submission of the sign-in form
  const onSignInPress = async () => {
    if (!isLoaded) return

    // Start the sign-in process using the email and password provided
    try {
      const signInAttempt = await signIn.create({
        identifier: emailAddress,
        password,
      })

      // If sign-in process is complete, set the created session as active
      // and redirect the user
      if (signInAttempt.status === 'complete') {
        await setActive({ session: signInAttempt.createdSessionId })
        navigateToInfo()
      } else {
        // If the status isn't complete, check why. User might need to
        // complete further steps.
        console.error(JSON.stringify(signInAttempt, null, 2))
      }
    } catch (err) {
      // See https://clerk.com/docs/custom-flows/error-handling
      // for more info on error handling
      console.error(JSON.stringify(err, null, 2))
    }
  }

  // Handle Google OAuth
  const onGooglePress = useCallback(async () => {
    try {
      console.log('Starting Google OAuth flow...');
      const redirectUrl = AuthSession.makeRedirectUri();
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
        navigateToInfo();
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
            navigateToInfo();
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
                navigateToInfo();
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
            navigateToInfo();
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
  }, [navigateToInfo]);

  // Handle Apple OAuth
  const onApplePress = useCallback(async () => {
    try {
      console.log('Starting Apple OAuth flow...');
      const redirectUrl = AuthSession.makeRedirectUri();
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
        navigateToInfo();
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
            navigateToInfo();
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
                navigateToInfo();
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
            navigateToInfo();
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
  }, [navigateToInfo]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerTitle: "Sign In",
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
        <TextInput
          style={[styles.input, { 
            backgroundColor: colors.card,
            borderColor: colors.border,
            color: colors.text,
          }]}
          autoCapitalize="none"
          value={emailAddress}
          placeholder="Enter email"
          placeholderTextColor={colors.secondaryText}
          onChangeText={(email) => setEmailAddress(email)}
        />
        <TextInput
          style={[styles.input, { 
            backgroundColor: colors.card,
            borderColor: colors.border,
            color: colors.text,
          }]}
          value={password}
          placeholder="Enter password"
          placeholderTextColor={colors.secondaryText}
          secureTextEntry={true}
          onChangeText={(password) => setPassword(password)}
        />
        <TouchableOpacity style={styles.button} onPress={onSignInPress}>
          <Text style={styles.buttonText}>Continue</Text>
        </TouchableOpacity>

        <View style={styles.divider}>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          <Text style={[styles.dividerText, { color: colors.secondaryText }]}>or</Text>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
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

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.secondaryText }]}>Don't have an account?</Text>
          <Link href="/sign-up" style={styles.link}>
            <Text style={[styles.linkText, { color: colors.link }]}>Sign up</Text>
          </Link>
        </View>
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
    height: 50,
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
});