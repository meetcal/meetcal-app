import { Stack } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';

export default function IndexLayout() {
  const { currentTheme } = useTheme();
  return <Stack screenOptions={{ headerStyle: { backgroundColor: currentTheme === 'dark' ? '#000000' : '#F5F5F5' } }}/>;
}
