import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Redirect, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import 'react-native-reanimated';

import { SavedSessionsProvider } from '@/contexts/SavedSessionsContext';
import { ThemeProvider as CustomThemeProvider, useTheme } from '@/contexts/ThemeContext';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });
  const [initialLoad, setInitialLoad] = useState(true);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
      // Set initialLoad to false after a brief delay
      const timer = setTimeout(() => setInitialLoad(false), 100);
      return () => clearTimeout(timer);
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <CustomThemeProvider>
      <SavedSessionsProvider>
        <RootLayoutNav initialLoad={initialLoad} />
      </SavedSessionsProvider>
    </CustomThemeProvider>
  );
}

function RootLayoutNav({ initialLoad }: { initialLoad: boolean }) {
  const { currentTheme } = useTheme();

  return (
    <ThemeProvider value={currentTheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen 
          name="(screens)/schedule-details" 
          options={{ 
            title: 'Session Details',
            headerBackTitle: 'Back',
            presentation: 'push',
            headerStyle: {
              backgroundColor: currentTheme === 'dark' ? '#000000' : '#FFFFFF',
            },
            headerTintColor: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
          }} 
        />
        <Stack.Screen name="+not-found" options={{ title: 'Oops!' }} />
      </Stack>
      <StatusBar style={currentTheme === 'dark' ? 'light' : 'dark'} />
      {initialLoad && <Redirect href="/(tabs)/schedule" />}
    </ThemeProvider>
  );
}
