// hooks/useAppColors.ts
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

export function useAppColors() {
  const theme = useColorScheme() ?? 'light';
  return Colors[theme];
}