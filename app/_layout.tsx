import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Redirect, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { SavedSessionsProvider } from '@/contexts/SavedSessionsContext';
import { ThemeProvider as CustomThemeProvider, useTheme } from '@/contexts/ThemeContext';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });
  const [initialLoad, setInitialLoad] = useState(true);
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    async function checkOnboarding() {
      const seen = await AsyncStorage.getItem('hasSeenOnboarding');
      setHasSeenOnboarding(!!seen);
      if (loaded) {
        SplashScreen.hideAsync();
        const timer = setTimeout(() => setInitialLoad(false), 100);
        return () => clearTimeout(timer);
      }
    }
    checkOnboarding();
  }, [loaded]);

  if (!loaded || hasSeenOnboarding === null) {
    return null;
  }

  return (
    <CustomThemeProvider>
      <SavedSessionsProvider>
        <RootLayoutNav initialLoad={initialLoad} hasSeenOnboarding={hasSeenOnboarding} />
      </SavedSessionsProvider>
    </CustomThemeProvider>
  );
}

function RootLayoutNav({ 
  initialLoad, 
  hasSeenOnboarding 
}: { 
  initialLoad: boolean;
  hasSeenOnboarding: boolean;
}) {
  const { currentTheme } = useTheme();

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
      {initialLoad && (
        <Redirect href={hasSeenOnboarding ? "/(tabs)/schedule" : "/(onboarding)"} />
      )}
    </ThemeProvider>
  );
}
