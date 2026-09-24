/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { PlatformPalette } from './Palette';
import { normalizePlatformKey } from '@/lib/athletes';

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
    borderBottom: "#C6C6C8",
    primaryText: '#000000',
    secondaryText: '#6B6B6B',
    placeholder: '#999999', 
    pressed: '#F5F5F5',
    // Translucent highlight for rows on glass/blur surfaces, where the
    // opaque `pressed` would paint a solid slab over the material.
    pressedTranslucent: 'rgba(120,120,128,0.16)',
    link: '#007AFF',
    modalBackground: "rgba(0,0,0,0.4)",
    success: '#34C759',
    fail: '#FF3B30',
    prColor: "#FF9500",
    totalColor: "#AF52DE",
    gold: "#FFD700",
    silver: "#C0C0C0",
    bronze: "#CD7F32",
    danger: '#FF3B30',
    wrappedPrimary: '#1DB954',
    wrappedAccent: '#FF6B6B',
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
    border: '#2C2C2E',
    borderBottom: "#2C2C2E",
    placeholder: '#8E8E93',
    primaryText: '#FFFFFF',
    secondaryText: '#8E8E93',
    pressed: '#2C2C2E',
    pressedTranslucent: 'rgba(120,120,128,0.28)',
    link: '#007AFF',
    modalBackground: "rgba(0,0,0,0.6)",
    success: '#34C759',
    fail: '#FF3B30',
    prColor: "#FF9500",
    totalColor: "#AF52DE",
    gold: "#FFD700",
    silver: "#C0C0C0",
    bronze: "#CD7F32",
    danger: '#FF3B30',
    wrappedPrimary: '#1DB954',
    wrappedAccent: '#FF6B6B',
  },
};

/**
 * Badge color by platform name. Keys are `normalizePlatformKey` form
 * (lowercase, whitespace collapsed); aliases share a token.
 */
const PLATFORM_COLOR_BY_KEY: Readonly<Record<string, string>> = {
  red: PlatformPalette.red,
  white: PlatformPalette.white,
  blue: PlatformPalette.blue,
  stars: PlatformPalette.stars,
  stripes: PlatformPalette.stripes,
  rogue: PlatformPalette.rogue,
  green: PlatformPalette.green,
  yellow: PlatformPalette.yellow,
  gold: PlatformPalette.gold,
  silver: PlatformPalette.silver,
  bronze: PlatformPalette.bronze,
  orange: PlatformPalette.orange,
  purple: PlatformPalette.purple,
  pink: PlatformPalette.pink,
  black: PlatformPalette.black,
  gray: PlatformPalette.gray,
  grey: PlatformPalette.gray,
  brown: PlatformPalette.brown,
  teal: PlatformPalette.teal,
  navy: PlatformPalette.navy,
  maroon: PlatformPalette.maroon,
};

/**
 * The one badge color for a session platform, used by every screen that
 * shows one so they all agree.
 *
 * Matches case-insensitively on the whole name (`"RED "` → red) and then on
 * the first word, so compound names like `"Red 2"` or `"Blue B"` keep their
 * color. Anything else (`"Gold Coast"`, `"Platform 3"`, an unknown name) gets
 * the one neutral color; the badge still shows the name.
 */
export function platformColor(platform: string | null | undefined): string {
  const key = normalizePlatformKey(platform);
  if (key.length === 0) return PlatformPalette.neutral;
  const exact = PLATFORM_COLOR_BY_KEY[key];
  if (exact) return exact;
  const firstWord = key.split(' ')[0];
  return PLATFORM_COLOR_BY_KEY[firstWord] ?? PlatformPalette.neutral;
}
