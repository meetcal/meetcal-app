import { useTheme } from '@/contexts/ThemeContext';
import { Stack } from 'expo-router';

export default function SavedLayout() {
  const { currentTheme } = useTheme();
  return (
    <Stack 
      screenOptions={{ 
        title: 'Saved', 
        headerStyle: { 
          backgroundColor: currentTheme === 'dark' ? '#000000' : '#F5F5F5' 
        },
        headerTitleStyle: {
          color: currentTheme === 'dark' ? '#fff' : '#000' ,
        } 
      }} 
    />
  );
}
