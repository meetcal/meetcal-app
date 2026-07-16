/**
 * Design tokens for the app. These codify the de-facto spacing, radius,
 * shadow and typography conventions already used across screens so that new
 * components can reference named tokens instead of hardcoding literals.
 */

import { TextStyle } from "react-native";

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 9999,
} as const;

/**
 * The de-facto card shadow used across the app (ScheduleSkeleton,
 * VersionAnnouncement, UpdateNotification). Includes the Android `elevation`.
 */
export const Shadows = {
  card: {
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
} as const;

/**
 * Typography scale consistent with the sizes defined in
 * `components/ui/ThemedText.tsx`.
 */
export const Type = {
  title: {
    fontSize: 32,
    fontWeight: "bold",
    lineHeight: 32,
  },
  subtitle: {
    fontSize: 20,
    fontWeight: "bold",
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
  },
  bodySemiBold: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600",
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
  },
  caption: {
    fontSize: 13,
    lineHeight: 18,
  },
} as const satisfies Record<string, TextStyle>;
