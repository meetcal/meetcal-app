import { Stack } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';

export default function OnboardingLayout() {
  const { currentTheme } = useTheme();
  
  return (
    <Stack screenOptions={{
      headerShown: false,
      contentStyle: {
        backgroundColor: currentTheme === 'dark' ? '#000000' : '#FFFFFF'
      }
    }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="user-profile" />
      <Stack.Screen name="subscription" />
    </Stack>
  );
} 