import { Stack } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';
import { Colors } from '@/constants/Colors';

export default function InfoLayout() {
  return <Stack screenOptions={{ title: 'Info', headerStyle: { backgroundColor: useTheme().currentTheme === 'dark' ? Colors.dark.background : Colors.light.background } }} />;
}
