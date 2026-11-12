import type { AppColors } from '@/constants/Colors';

type HeaderColors = Pick<AppColors, 'headerTitle' | 'headerBackground' | 'text'>;

export function stackHeaderOptions(colors: HeaderColors) {
  return {
    headerShown: true,
    headerBackTitle: 'Back',
    headerBackButtonDisplayMode: 'minimal',
    headerTitleStyle: { color: colors.headerTitle },
    headerStyle: { backgroundColor: colors.headerBackground },
    headerShadowVisible: false,
    headerTintColor: colors.text,
  } as const;
}

export const SLIDE_IN_FROM_RIGHT = {
  gestureEnabled: true,
  gestureDirection: 'horizontal',
  animation: 'slide_from_right',
} as const;
