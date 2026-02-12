/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

const tintColorLight = '#0a7ea4';
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#F5F5F5',
    tint: '#fff',
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: '#fff',
    screenBackground: '#F5F5F5',
    card: '#FFFFFF',
    border: '#E1E1E1',
    primaryText: '#000000',
    secondaryText: '#6B6B6B',
    pressed: '#F5F5F5',
    link: '#007AFF',
  },
  dark: {
    text: '#ECEDEE',
    background: '#000',
    tint: '#0a7ea4',
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: '#0a7ea4',
    screenBackground: '#000000',
    card: '#1C1C1E',
    border: '#38383A',
    primaryText: '#FFFFFF',
    secondaryText: '#8E8E93',
    pressed: '#2C2C2E',
    link: '#007AFF',
  },
};

export function getPlatformColors() {
  return {
    Red: '#FF3B30',
    White: '#8E8E93',
    Blue: '#007AFF',
    Stars: '#AF52DE',
    Stripes: '#34C759',
    Rogue: '#000000',
  } as const;
}
