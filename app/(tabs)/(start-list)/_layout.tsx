import { Stack } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';

export default function StartListLayout() {
  const { currentTheme } = useTheme();
  return <Stack screenOptions={{ title: 'Start List', headerStyle: { backgroundColor: currentTheme === 'dark' ? '#000000' : '#F5F5F5' } }} />;
}
