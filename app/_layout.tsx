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
import * as QuickActions from 'expo-quick-actions';
import { supabase } from '@/lib/supabase';
import { registerForPushNotificationsAsync } from '@/utils/notifications';

import { SavedSessionsProvider } from '@/contexts/SavedSessionsContext';
import { ThemeProvider as CustomThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { SubscriptionProvider, useSubscription } from '@/contexts/SubscriptionContext';
import { SelectedMeetProvider } from '@/contexts/SelectedMeetContext';
import { getSimulatedSubscriptionStatus } from '@/config/development';
import { posthog } from '@/lib/posthog';
import { UpdateNotification } from '@/components/UpdateNotification';
import { AnimatedSplashScreen } from '@/components/AnimatedSplashScreen';
import { useWidgets, handleWidgetDeepLink } from '@/hooks/useWidgets';

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
  const [showAnimatedSplash, setShowAnimatedSplash] = useState(true);
  const hasAttemptedSplashHide = useRef(false);
  const router = useRouter();
  const { isLoaded: isUserLoaded, isSignedIn: isUserSignedIn, user } = useUser();
  
  // Initialize widgets
  useWidgets();
  
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

  // Quick Actions handler
  useEffect(() => {
    const handleQuickAction = (action: QuickActions.Action | null) => {
      if (!action) return;
      
      // Only navigate if user is signed in
      if (!isUserSignedIn) return;
      
      switch (action.id) {
        case 'schedule':
          router.push('/(tabs)/' as any);
          break;
        case 'qualifying-totals':
          router.push('/(screens)/new-qualifying-totals');
          break;
        case 'records':
          router.push('/(screens)/records');
          break;
        default:
          break;
      }
    };

    // Set up quick actions dynamically
    setTimeout(() => {
      QuickActions.setItems([
      {
        title: "View Schedule",
        subtitle: "Check today's competitions",
        icon: "symbol:calendar",
        id: "schedule"
      },
      {
        title: "Qualifying Totals", 
        subtitle: "View competition qualifying totals",
        icon: "symbol:list.bullet",
        id: "qualifying-totals"
      },
      {
        title: "Records",
        subtitle: "Browse competition records", 
        icon: "symbol:trophy.fill",
        id: "records"
      }
      ]);
    }, 1000);

    // Handle quick action on app launch
    handleQuickAction(QuickActions.initial || null);

    // Listen for quick actions while app is running
    const subscription = QuickActions.addListener(handleQuickAction);

    return () => {
      subscription?.remove();
    };
  }, [isUserSignedIn, router]);

  // Widget deep link handling
  useEffect(() => {
    const handleDeepLinkFromWidget = (url: string) => {
      if (!isUserSignedIn) return;
      
      const result = handleWidgetDeepLink(url);
      
      switch (result.action) {
        case 'select-meet':
          // Navigate to main schedule screen where meet selection happens
          router.push('/(tabs)/' as any);
          break;
        case 'saved-sessions':
          // Navigate to saved sessions (could be a specific screen or the main screen with saved sessions shown)
          router.push('/(tabs)/saved' as any);
          break;
        default:
          router.push('/(tabs)/' as any);
          break;
      }
    };

    // Handle initial URL when app is opened from widget
    Linking.getInitialURL().then((url) => {
      if (url && url.startsWith('meetcal://')) {
        handleDeepLinkFromWidget(url);
      }
    });

    // Handle URLs when app is already running
    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (url.startsWith('meetcal://')) {
        handleDeepLinkFromWidget(url);
      }
    });

    return () => {
      subscription?.remove();
    };
  }, [isUserSignedIn, router]);

  // Hide Expo splash screen early to show our custom one
  useEffect(() => {
    async function hideExpoSplash() {
      if (fontsLoaded && !hasAttemptedSplashHide.current) {
        hasAttemptedSplashHide.current = true;
        await SplashScreen.hideAsync();
      }
    }

    hideExpoSplash();
  }, [fontsLoaded]);

  // Handle navigation after app is fully initialized
  useEffect(() => {
    async function handleNavigation() {
      if (isInitialized && !isSubscriptionLoading && isUserLoaded && !showAnimatedSplash) {
        const initialUrl = await Linking.getInitialURL();

        if (initialUrl) {
          console.log('[RootLayout] App launched with initial URL, letting router handle:', initialUrl);
          if (!isUserSignedIn) {
            if (!initialUrl.includes('/sign-in') && !initialUrl.includes('/sign-up')) { // Example check
                router.replace('/sign-in');
            }
          }
        } else {
          // No deep link, proceed with default routing
          if (!isUserSignedIn) {
            router.replace('/sign-in');
          } else {
            router.replace('/(tabs)');
          }
        }
      }
    }

    handleNavigation();
  }, [isInitialized, isSubscriptionLoading, isUserLoaded, isUserSignedIn, showAnimatedSplash, router]);

  const handleAnimationComplete = () => {
    setShowAnimatedSplash(false);
  };

  const isAppReady = isInitialized && !isSubscriptionLoading && isUserLoaded;

  // Always show our custom animated splash screen first
  if (showAnimatedSplash) {
    return (
      <AnimatedSplashScreen 
        onAnimationComplete={handleAnimationComplete}
      />
    );
  }

  // Only show main app after splash animation completes AND app is ready
  if (!isAppReady) {
    return null; // Brief moment between splash and app loading
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const { currentTheme } = useTheme();
  const theme = currentTheme === 'dark' ? DarkTheme : DefaultTheme;

  return (
    <NavigationThemeProvider value={theme}>
      <UpdateNotification />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
      </Stack>
      <StatusBar style={currentTheme === 'dark' ? 'light' : 'dark'} />
    </NavigationThemeProvider>
  );
}

