import { Stack } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';
import { Colors } from '@/constants/Colors';

export default function SavedLayout() {
  return <Stack screenOptions={{ title: 'Saved', headerStyle: { backgroundColor: useTheme().currentTheme === 'dark' ? Colors.dark.background : Colors.light.background } }} />;
}
