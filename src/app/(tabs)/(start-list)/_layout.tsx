import { useAppColors } from '@/hooks/useAppColors';
import { Stack } from 'expo-router';

export default function StartListLayout() {
  const colors = useAppColors();
  return (
    <Stack 
      screenOptions={{ 
        title: 'Start List', 
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
