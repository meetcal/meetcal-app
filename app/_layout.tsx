import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Redirect, Stack, Slot } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

  if (!isSubscribed) {
    return (
      <ThemeProvider value={currentTheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack screenOptions={{ headerShown: false }}>
          {!hasSeenOnboarding ? (
            <Stack.Screen name="(onboarding)" />
          ) : (
            <Stack.Screen 
              name="(screens)/subscription" 
              options={{
                headerShown: true,
                title: 'Premium Features',
                headerBackTitle: 'Back',
              }}
            />
          )}
        </Stack>
        <StatusBar style={currentTheme === 'dark' ? 'light' : 'dark'} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider value={currentTheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen 
          name="(screens)/schedule-details" 
          options={{ 
            headerShown: true,
            title: 'Session Details',
            headerBackTitle: 'Back',
            presentation: 'push',
            headerStyle: {
              backgroundColor: currentTheme === 'dark' ? '#000000' : '#FFFFFF',
            },
            headerTintColor: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
          }} 
        />
        <Stack.Screen 
          name="(screens)/subscription" 
          options={{
            headerShown: true,
            title: 'Premium Features',
            headerBackTitle: 'Back',
          }}
        />
        <Stack.Screen name="(onboarding)" />
      </Stack>
      <StatusBar style={currentTheme === 'dark' ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}
