// hooks/useAppColors.ts
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

/** The resolved palette for the active colour scheme. */
export type AppColors = (typeof Colors)['light'];

export function useAppColors(): AppColors {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? 'dark' : 'light';
  return Colors[theme];
}
