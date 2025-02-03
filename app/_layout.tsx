import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, Slot } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { storage } from '@/utils/storage';

import { SavedSessionsProvider } from '@/contexts/SavedSessionsContext';
import { ThemeProvider as CustomThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { SubscriptionProvider, useSubscription } from '@/contexts/SubscriptionContext';
import { OnboardingProvider, useOnboarding } from '@/contexts/OnboardingContext';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <OnboardingProvider>
      <SubscriptionProvider>
        <CustomThemeProvider>
          <SavedSessionsProvider>
            <RootLayoutNav />
          </SavedSessionsProvider>
        </CustomThemeProvider>
      </SubscriptionProvider>
    </OnboardingProvider>
  );
}

function RootLayoutNav() {
  const { currentTheme } = useTheme();
  const { hasSeenSubscription } = useOnboarding();
  const { isSubscribed, isLoading } = useSubscription();

  if (isLoading) {
    return <Slot />;
  }

  return (
    <ThemeProvider value={currentTheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        {!hasSeenSubscription && <Stack.Screen name="(onboarding)" />}
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
  );
}
