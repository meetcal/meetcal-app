import { Stack } from 'expo-router';
import { Colors } from '@/constants/Colors';
import { useTheme } from '@/contexts/ThemeContext';

export default function IndexLayout() {
  return <Stack screenOptions={{ headerStyle: { backgroundColor: useTheme().currentTheme === 'dark' ? Colors.dark.background : Colors.light.background } }}/>;
}
