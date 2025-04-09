import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Redirect, Stack, Slot, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, useCallback, useRef } from 'react';
import 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Purchases from 'react-native-purchases';
import { Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { PostHogProvider } from 'posthog-react-native';
import { ClerkProvider, useUser } from '@clerk/clerk-expo'
import { tokenCache } from '@clerk/clerk-expo/token-cache'
import * as SecureStore from 'expo-secure-store'

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
  const { isLoaded: isUserLoaded, isSignedIn, user } = useUser();
  
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

  useEffect(() => {
    async function hideSplash() {
      if (!hasAttemptedSplashHide.current && isInitialized && !isSubscriptionLoading && fontsLoaded && isUserLoaded) {
        hasAttemptedSplashHide.current = true;
        await SplashScreen.hideAsync();
        
        // Only route to sign-in or schedule, no automatic paywall redirect
        if (!isSignedIn) {
          router.replace('/sign-in');
        } else {
          router.replace('/(tabs)/schedule');
        }
      }
    }

    hideSplash();
  }, [isInitialized, isSubscriptionLoading, fontsLoaded, isUserLoaded, isSignedIn, router]);

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
