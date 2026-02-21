import { useTheme } from '@/contexts/ThemeContext';
import { Stack } from 'expo-router';

export default function IndexLayout() {
  const { currentTheme } = useTheme();
  return (
    <Stack 
      screenOptions={{ 
        headerStyle: { 
          backgroundColor: currentTheme === 'dark' ? '#000000' : '#F5F5F5' 
        }, 
        headerShadowVisible: false
      }}
    />);
}
