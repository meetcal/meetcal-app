// hooks/useAppColors.ts
import { Colors, type AppColors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

export type { AppColors } from '@/constants/Colors';

export function useAppColors(): AppColors {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? 'dark' : 'light';
  return Colors[theme];
}
