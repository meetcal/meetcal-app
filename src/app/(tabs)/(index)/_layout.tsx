import { useAppColors } from '@/hooks/useAppColors';
import { Stack } from 'expo-router';

export default function IndexLayout() {
  const colors = useAppColors();
  return (
    <Stack 
      screenOptions={{ 
        headerStyle: { 
          backgroundColor: colors.headerBackground,
        }, 
        headerShadowVisible: false,
        headerTitleStyle: {
          color: colors.headerTitle,
        }
      }}
    />);
}
