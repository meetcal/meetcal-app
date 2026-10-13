import { useAppColors } from '@/hooks/useAppColors';
import { Stack } from 'expo-router';

export default function SavedLayout() {
  const colors = useAppColors();
  return (
    <Stack 
      screenOptions={{ 
        title: 'Saved', 
        headerStyle: { 
          backgroundColor: colors.headerBackground,
        },
        headerTitleStyle: {
          color: colors.headerTitle,
        } 
      }} 
    />
  );
}
