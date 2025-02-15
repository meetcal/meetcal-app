import { Stack } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';

export default function OnboardingLayout() {
  const { currentTheme } = useTheme();
  
  return (
    <Stack screenOptions={{
      headerShown: false,
      contentStyle: {
        backgroundColor: currentTheme === 'dark' ? '#0A1A2F' : '#F0F7FF'
      }
    }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="user-profile" />
      <Stack.Screen name="subscription" />
    </Stack>
  );
} 