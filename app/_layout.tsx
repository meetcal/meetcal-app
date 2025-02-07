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
          if (__DEV__) {
            Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
          }
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
              <AppContent />
            </SavedSessionsProvider>
          </SubscriptionProvider>
        </CustomThemeProvider>
      </NavigationThemeProvider>
    </View>
  );
}

function AppContent() {
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | null>(null);
  const { isSubscribed, isLoading } = useSubscription();
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    async function initialize() {
      try {
        const seen = await AsyncStorage.getItem('hasSeenOnboarding');
        setHasSeenOnboarding(!!seen);
        setIsInitialized(true);
      } catch (error) {
        console.error('Initialization error:', error);
        setIsInitialized(true);
      }
    }

    initialize();
  }, []);

  useEffect(() => {
    if (isInitialized && hasSeenOnboarding !== null && !isLoading) {
      SplashScreen.hideAsync();
    }
  }, [isInitialized, hasSeenOnboarding, isLoading]);

  if (!isInitialized || hasSeenOnboarding === null || isLoading) {
    return null;
  }

  return <RootLayoutNav hasSeenOnboarding={hasSeenOnboarding} />;
}

function RootLayoutNav({ hasSeenOnboarding }: { hasSeenOnboarding: boolean }) {
  const { currentTheme } = useTheme();
  const { isSubscribed, isLoading } = useSubscription();
  const hasRedirected = useRef(false);
  const router = useRouter();

  useEffect(() => {
    if (!hasRedirected.current && !isLoading && isSubscribed) {
      hasRedirected.current = true;
      router.replace('/(tabs)/schedule');
    }
  }, [isLoading, isSubscribed, router]);

  if (isLoading) {
    return <Slot />;
  }

  const theme = currentTheme === 'dark' ? DarkTheme : DefaultTheme;

  // Remove the redirect and just render the navigation
  return (
    <NavigationThemeProvider value={theme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(screens)/schedule-details" />
        <Stack.Screen 
          name="(screens)/subscription" 
          options={{
            headerShown: true,
            title: 'Premium Features',
            headerBackTitle: 'Back',
          }}
        />
      </Stack>
      <StatusBar style={currentTheme === 'dark' ? 'light' : 'dark'} />
    </NavigationThemeProvider>
  );
}
