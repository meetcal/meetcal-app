import { Stack } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';

export default function InfoLayout() {
  const { currentTheme } = useTheme();
  return <Stack screenOptions={{ title: 'Info', headerStyle: { backgroundColor: currentTheme === 'dark' ? '#000000' : '#F5F5F5' } }} />;
}
