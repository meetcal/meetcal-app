import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Redirect, Stack, Slot } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, useCallback, useRef } from 'react';
import 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Purchases from 'react-native-purchases';
import { Platform, View } from 'react-native';
import { useRouter } from 'expo-router';

import { SavedSessionsProvider } from '@/contexts/SavedSessionsContext';
import { ThemeProvider as CustomThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { SubscriptionProvider, useSubscription } from '@/contexts/SubscriptionContext';
import { SelectedMeetProvider } from '@/contexts/SelectedMeetContext';

// Keep splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [appIsReady, setAppIsReady] = useState(false);
  
  // Load any fonts you need here
  const [fontsLoaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    // Initialize RevenueCat
    const initializeRevenueCat = async () => {
      try {
        if (Platform.OS === 'ios') {
          await Purchases.configure({ apiKey: 'appl_UriFuFjiRHwcmgkTgoAgENezgcv' });
        } else if (Platform.OS === 'android') {
          await Purchases.configure({ 
            apiKey: 'goog_tUXAGSdnOuHiTVFNSvQKHxNTbpI',
            appUserID: null, // RevenueCat will generate a random ID
          });
        }

        if (__DEV__) {
          Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
        }
      } catch (error) {
        console.error('Failed to initialize RevenueCat:', error);
      }
    };

    initializeRevenueCat();
  }, []);

  useEffect(() => {
    async function prepare() {
      try {
        // Pre-load any resources, make API calls, etc.
        // For example, initialize services, load initial data, etc.
        await new Promise(resolve => setTimeout(resolve, 1000)); // Optional delay for smoother transition
      } catch (e) {
        console.warn(e);
      } finally {
        setAppIsReady(true);
      }
    }

    prepare();
  }, []);

  const onLayoutRootView = useCallback(async () => {
    if (appIsReady && fontsLoaded) {
      await SplashScreen.hideAsync();
    }
  }, [appIsReady, fontsLoaded]);

  if (!appIsReady || !fontsLoaded) {
    return null;
  }

  return (
    <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <NavigationThemeProvider value={DefaultTheme}>
        <CustomThemeProvider>
          <SubscriptionProvider>
            <SavedSessionsProvider>
              <SelectedMeetProvider>
                <AppContent />
              </SelectedMeetProvider>
            </SavedSessionsProvider>
          </SubscriptionProvider>
        </CustomThemeProvider>
      </NavigationThemeProvider>
    </View>
  );
}

function AppContent() {
  const { isSubscribed, isLoading } = useSubscription();
  const [isInitialized, setIsInitialized] = useState(false);

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
    if (isInitialized && !isLoading) {
      SplashScreen.hideAsync();
    }
  }, [isInitialized, isLoading]);

  if (!isInitialized || isLoading) {
    return null;
  }

  return <RootLayoutNav isSubscribed={isSubscribed} />;
}

function RootLayoutNav({ isSubscribed }: { isSubscribed: boolean }) {
  const { currentTheme } = useTheme();
  const router = useRouter();

  useEffect(() => {
    // Redirect based on subscription status
    if (!isSubscribed) {
      router.replace('/(onboarding)');
    } else {
      router.replace('/(tabs)/schedule');
    }
  }, [isSubscribed, router]);

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
