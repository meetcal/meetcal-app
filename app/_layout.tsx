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
        // On error, we'll still proceed but may need to check subscription status later
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
    <PostHogProvider client={posthog}>
      <CustomThemeProvider>
        <NavigationThemeProvider value={DefaultTheme}>
          <SubscriptionProvider>
            <SavedSessionsProvider>
              <SelectedMeetProvider>
                <PostHogPageView />
                <AppContent fontsLoaded={fontsLoaded} />
              </SelectedMeetProvider>
            </SavedSessionsProvider>
          </SubscriptionProvider>
        </NavigationThemeProvider>
      </CustomThemeProvider>
    </PostHogProvider>
  );
}

function AppContent({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { isSubscribed, isLoading } = useSubscription();
  const [isInitialized, setIsInitialized] = useState(false);
  const hasAttemptedSplashHide = useRef(false);
  const router = useRouter();

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

  useEffect(() => {
    async function hideSplash() {
      if (!hasAttemptedSplashHide.current && isInitialized && !isLoading && fontsLoaded) {
        hasAttemptedSplashHide.current = true;
        // Wait for subscription status to be determined before hiding splash
        if (isSubscribed !== null) {
          await SplashScreen.hideAsync();
          // Immediately navigate to the correct screen
          if (isSubscribed) {
            router.replace('/(tabs)/schedule');
          } else {
            router.replace('/(onboarding)');
          }
        }
      }
    }

    hideSplash();
  }, [isInitialized, isLoading, fontsLoaded, isSubscribed, router]);

  if (!isInitialized || isLoading || isSubscribed === null) {
    return null;
  }

  return <RootLayoutNav isSubscribed={isSubscribed} />;
}

function RootLayoutNav({ isSubscribed }: { isSubscribed: boolean | null }) {
  const { currentTheme } = useTheme();
  const theme = currentTheme === 'dark' ? DarkTheme : DefaultTheme;

  return (
    <NavigationThemeProvider value={theme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(onboarding)" options={{ animation: 'none' }} />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(screens)" />
      </Stack>
      <StatusBar style={currentTheme === 'dark' ? 'light' : 'dark'} />
    </NavigationThemeProvider>
  );
}
