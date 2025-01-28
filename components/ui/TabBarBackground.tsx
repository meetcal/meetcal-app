// This is a shim for web and Android where the tab bar is generally opaque.
import { View } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';

export default function TabBarBackground() {
  const { currentTheme } = useTheme();
  
  return (
    <View 
      style={{ 
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: currentTheme === 'dark' ? '#000000' : '#FFFFFF',
      }} 
    />
  );
}

export function useBottomTabOverflow() {
  return 0;
}
