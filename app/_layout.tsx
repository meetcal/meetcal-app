import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Redirect, Stack, Slot } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Purchases from 'react-native-purchases';
import { Platform } from 'react-native';

import { SavedSessionsProvider } from '@/contexts/SavedSessionsContext';
import { ThemeProvider as CustomThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { SubscriptionProvider, useSubscription } from '@/contexts/SubscriptionContext';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    async function checkOnboarding() {
      const seen = await AsyncStorage.getItem('hasSeenOnboarding');
      setHasSeenOnboarding(!!seen);
      if (loaded) {
        SplashScreen.hideAsync();
      }
    }
    checkOnboarding();
  }, [loaded]);

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

  if (!loaded || hasSeenOnboarding === null) {
    return null;
  }

  return (
    <SubscriptionProvider>
      <CustomThemeProvider>
        <SavedSessionsProvider>
          <RootLayoutNav hasSeenOnboarding={hasSeenOnboarding} />
        </SavedSessionsProvider>
      </CustomThemeProvider>
    </SubscriptionProvider>
  );
}

function RootLayoutNav({ hasSeenOnboarding }: { hasSeenOnboarding: boolean }) {
  const { currentTheme } = useTheme();
  const { isSubscribed, isLoading } = useSubscription();

  if (isLoading) {
    return <Slot />;
  }

  const theme = currentTheme === 'dark' ? DarkTheme : DefaultTheme;

  // Early return with redirect for subscribed users
  if (isSubscribed) {
    return (
      <>
        <Redirect href="/(tabs)/schedule" />
        <ThemeProvider value={theme}>
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
        </ThemeProvider>
      </>
    );
  }

  // Early return with redirect for non-subscribed users based on onboarding
  if (!hasSeenOnboarding) {
    return (
      <>
        <Redirect href="/(onboarding)" />
        <ThemeProvider value={theme}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(onboarding)" />
          </Stack>
          <StatusBar style={currentTheme === 'dark' ? 'light' : 'dark'} />
        </ThemeProvider>
      </>
    );
  }

  // Default case: show subscription screen for non-subscribed users who've seen onboarding
  return (
    <ThemeProvider value={theme}>
      <Stack screenOptions={{ headerShown: false }}>
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
    </ThemeProvider>
  );
}
