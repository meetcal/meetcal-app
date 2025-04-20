import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Redirect, Stack, Slot, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, useCallback, useRef } from 'react';
import 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Purchases from 'react-native-purchases';
import { Platform, View, Alert, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { PostHogProvider } from 'posthog-react-native';
import { ClerkProvider, useAuth, useUser } from '@clerk/clerk-expo'
import { tokenCache } from '@clerk/clerk-expo/token-cache'
import * as SecureStore from 'expo-secure-store'
import * as Notifications from 'expo-notifications';
import { supabase } from '@/lib/supabase';
import { registerForPushNotificationsAsync } from '@/utils/notifications';

import { SavedSessionsProvider } from '@/contexts/SavedSessionsContext';
import { ThemeProvider as CustomThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { SubscriptionProvider, useSubscription } from '@/contexts/SubscriptionContext';
import { SelectedMeetProvider } from '@/contexts/SelectedMeetContext';
import { getSimulatedSubscriptionStatus } from '@/config/development';
import { posthog } from '@/lib/posthog';

// Get RevenueCat keys from environment
const REVENUECAT_IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS!;
const REVENUECAT_ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID!;

if (!REVENUECAT_IOS_KEY || !REVENUECAT_ANDROID_KEY) {
  throw new Error('RevenueCat API keys are required');
}

// Keep splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

// PostHog page view tracking component
function PostHogPageView() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname) {
      posthog?.capture('$pageview', {
        $current_url: pathname,
      });
    }
  }, [pathname]);

  return null;
}

async function requestNotificationPermissions() {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  
  if (existingStatus === 'granted') return true;
  
  if (existingStatus === 'denied') {
    Alert.alert(
      'Notifications Required',
      'To receive session reminders, please enable notifications in your device settings.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Open Settings', 
          onPress: () => Linking.openSettings()
        }
      ]
    );
    return false;
  }

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export default function RootLayout() {
  const [appIsReady, setAppIsReady] = useState(false);
  
  const [fontsLoaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    async function prepare() {
      try {
        // Initialize RevenueCat first
        if (Platform.OS === 'ios') {
          await Purchases.configure({ 
            apiKey: REVENUECAT_IOS_KEY
          });
        } else if (Platform.OS === 'android') {
          await Purchases.configure({ 
            apiKey: REVENUECAT_ANDROID_KEY,
            appUserID: null,
          });
        }

        if (__DEV__) {
          Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
        }

        // Request notification permissions
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#FF231F7C',
          });
        }
        
        // Request notification permissions early
        const hasCheckedNotifications = await AsyncStorage.getItem('hasCheckedNotifications');
        if (!hasCheckedNotifications) {
          await requestNotificationPermissions();
          await AsyncStorage.setItem('hasCheckedNotifications', 'true');
        }

        // Optional: Add a small delay for smoother transition
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (e) {
        console.warn('Initialization error:', e);
      } finally {
        setAppIsReady(true);
      }
    }

    prepare();
  }, []);

  if (!appIsReady || !fontsLoaded) {
    return null;
  }

  return (
    <CustomThemeProvider>
      <NavigationThemeProvider value={DefaultTheme}>
        <ClerkProvider 
          publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!}
          tokenCache={tokenCache}
        >
          <PostHogProvider client={posthog}>
            <SubscriptionProvider>
              <SavedSessionsProvider>
                <SelectedMeetProvider>
                  <PostHogPageView />
                  <AppContent fontsLoaded={fontsLoaded} />
                </SelectedMeetProvider>
              </SavedSessionsProvider>
            </SubscriptionProvider>
          </PostHogProvider>
        </ClerkProvider>
      </NavigationThemeProvider>
    </CustomThemeProvider>
  );
}

function AppContent({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { isSubscribed, isLoading: isSubscriptionLoading } = useSubscription();
  const [isInitialized, setIsInitialized] = useState(false);
  const hasAttemptedSplashHide = useRef(false);
  const router = useRouter();
  const { isLoaded: isUserLoaded, isSignedIn: isUserSignedIn, user } = useUser();
  
  useEffect(() => {
    async function initialize() {
      try {
        setIsInitialized(true);
      } catch (error) {
        console.error('Initialization error:', error);
        setIsInitialized(true);
      }
    }

    initialize();
  }, []);

  // Effect to sync Clerk user with RevenueCat
  useEffect(() => {
    async function syncUserWithRevenueCat() {
      if (isUserLoaded && user) {
        try {
          const email = user.primaryEmailAddress?.emailAddress;
          if (email) {
            console.log('Syncing user email with RevenueCat:', email);
            await Purchases.setEmail(email);
            await Purchases.logIn(user.id);
          }
        } catch (error) {
          console.error('Error syncing user with RevenueCat:', error);
        }
      }
    }

    syncUserWithRevenueCat();
  }, [isUserLoaded, user]);

  // Effect to sync Clerk user with Supabase
  useEffect(() => {
    async function syncUserWithSupabase() {
      if (isUserLoaded && user) {
        try {
          const email = user.primaryEmailAddress?.emailAddress;
          if (email) {
            console.log('Syncing user with Supabase:', user.id);
            
            // Check if user exists first
            const { data: existingUser } = await supabase
              .from('users')
              .select('id')
              .eq('id', user.id)
              .single();

            if (!existingUser) {
              // User doesn't exist in Supabase, create them
              const { error } = await supabase.from('users').insert({
                id: user.id,
                first_name: user.firstName || '',
                last_name: user.lastName || '',
                email: email,
                role: 'Athlete', // Default role
              });

              if (error) {
                console.error('Error creating user in Supabase:', error);
              }
            }
          }
        } catch (error) {
          console.error('Error syncing user with Supabase:', error);
        }
      }
    }

    syncUserWithSupabase();
  }, [isUserLoaded, user]);

  // Push Notification Registration useEffect 
  useEffect(() => {
    // Check if user is loaded and has an ID before registering
    if (isUserLoaded && user?.id) { 
      // Introduce a short delay (e.g., 1 second) before registering
      const timer = setTimeout(() => {
          registerForPushNotificationsAsync(user.id);
      }, 1000); // 1000ms = 1 second delay
      
      // Cleanup function to clear the timer if the component unmounts
      // or if user state changes before the timer fires
      return () => clearTimeout(timer);
    }
    // Depend on user.id AND isUserLoaded to ensure it runs when user logs in
  }, [isUserLoaded, user?.id]); 

  useEffect(() => {
    async function hideSplash() {
      if (!hasAttemptedSplashHide.current && isInitialized && !isSubscriptionLoading && fontsLoaded && isUserLoaded) {
        hasAttemptedSplashHide.current = true;
        await SplashScreen.hideAsync();
        
        // Only route to sign-in or schedule, no automatic paywall redirect
        if (!isUserSignedIn) {
          router.replace('/sign-in');
        } else {
          router.replace('/(tabs)/schedule');
        }
      }
    }

    hideSplash();
  }, [isInitialized, isSubscriptionLoading, fontsLoaded, isUserLoaded, isUserSignedIn, router]);

  if (!isInitialized || isSubscriptionLoading || !isUserLoaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const { currentTheme } = useTheme();
  const theme = currentTheme === 'dark' ? DarkTheme : DefaultTheme;

  return (
    <NavigationThemeProvider value={theme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="sign-in" options={{ animation: 'none' }} />
        <Stack.Screen name="paywall" options={{ animation: 'none' }} />
        <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
      </Stack>
      <StatusBar style={currentTheme === 'dark' ? 'light' : 'dark'} />
    </NavigationThemeProvider>
  );
}
