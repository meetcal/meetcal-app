import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Redirect, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { SavedSessionsProvider } from '@/contexts/SavedSessionsContext';
import { ThemeProvider as CustomThemeProvider } from '@/contexts/ThemeContext';

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
    <CustomThemeProvider>
      <SavedSessionsProvider>
        <ThemeProvider value={DefaultTheme}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen 
              name="(screens)/schedule-details" 
              options={{ 
                title: 'Session Details',
                headerBackTitle: 'Back',
                presentation: 'push',
              }} 
            />
            <Stack.Screen name="+not-found" options={{ title: 'Oops!' }} />
          </Stack>
          <StatusBar style="auto" />
          <Redirect href="/(tabs)/schedule" />
        </ThemeProvider>
      </SavedSessionsProvider>
    </CustomThemeProvider>
  );
}
