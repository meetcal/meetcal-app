import { useSignIn } from '@clerk/clerk-expo'
import { Link, useRouter, Stack } from 'expo-router'
import { Text, TextInput, TouchableOpacity, View, StyleSheet, Platform } from 'react-native'
import React, { useCallback, useEffect } from 'react'
import * as WebBrowser from 'expo-web-browser'
import * as AuthSession from 'expo-auth-session'
import { useSSO } from '@clerk/clerk-expo'
import { IconSymbol } from '@/components/ui/IconSymbol'

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

export default function Page() {
  const { signIn, setActive, isLoaded } = useSignIn()
  const { startSSOFlow } = useSSO()
  const router = useRouter()

  useWarmUpBrowser()

  const [emailAddress, setEmailAddress] = React.useState('')
  const [password, setPassword] = React.useState('')

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
    <View style={styles.container}>
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
                color="#007AFF"
              />
            </TouchableOpacity>
          ),
          headerStyle: {
            backgroundColor: '#FFFFFF',
          },
          headerShadowVisible: false,
        }}
      />

      <View style={styles.content}>
        <Text style={styles.title}>Sign in</Text>
        
        {/* Email/Password Sign In */}
        <TextInput
          style={styles.input}
          autoCapitalize="none"
          value={emailAddress}
          placeholder="Enter email"
          onChangeText={(emailAddress) => setEmailAddress(emailAddress)}
        />
        <TextInput
          style={styles.input}
          value={password}
          placeholder="Enter password"
          secureTextEntry={true}
          onChangeText={(password) => setPassword(password)}
        />
        <TouchableOpacity style={styles.button} onPress={onSignInPress}>
          <Text style={styles.buttonText}>Continue</Text>
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* OAuth Buttons */}
        <TouchableOpacity 
          style={[styles.button, styles.googleButton]} 
          onPress={onGooglePress}
        >
          <Text style={[styles.buttonText, styles.googleButtonText]}>
            Sign in with Google
          </Text>
        </TouchableOpacity>

        {Platform.OS === 'ios' && (
          <TouchableOpacity 
            style={[styles.button, styles.appleButton]} 
            onPress={onApplePress}
          >
            <Text style={[styles.buttonText, styles.appleButtonText]}>
              Sign in with Apple
            </Text>
          </TouchableOpacity>
        )}

        <View style={styles.footer}>
          <Text style={styles.footerText}>Don't have an account?</Text>
          <Link href="/sign-up" style={styles.link}>
            <Text style={styles.linkText}>Sign up</Text>
          </Link>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
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
    borderColor: '#ddd',
    padding: 15,
    borderRadius: 8,
    marginBottom: 15,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
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
    color: '#666',
  },
  link: {
    marginLeft: 5,
  },
  linkText: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '600',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#ddd',
  },
  dividerText: {
    marginHorizontal: 10,
    color: '#666',
  },
  googleButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  googleButtonText: {
    color: '#000',
  },
  appleButton: {
    backgroundColor: '#000',
    marginTop: 12,
  },
  appleButtonText: {
    color: '#fff',
  },
});