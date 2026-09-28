/**
 * Static colors: values that are the same in light and dark mode.
 *
 * Theme colors live in `Colors` and reach components through
 * `useAppColors()`. Everything here is fixed by design: iOS system tints,
 * text on filled buttons, the shadow color, fixed-dark surfaces (Wrapped,
 * the club recap share card), and translucent overlays. Each value is the
 * one the StyleSheets used when it was a literal, so naming a color here
 * never changes what renders.
 */
export const Palette = {
  white: "#FFFFFF",
  black: "#000000",
  transparent: "transparent",
  /** `shadowColor` for card, sheet, and button elevation. */
  shadow: "#000000",

  // iOS system colors.
  systemBlue: "#007AFF",
  systemGreen: "#34C759",
  systemRed: "#FF3B30",
  systemGray: "#8E8E93",

  /** Secondary text on the fixed-white saved-session card. */
  mediumGray: "#666666",
  /** Hairline separators on fixed-white surfaces. */
  lightSeparator: "#E1E1E1",
  /** Border on the filled onboarding button. */
  neutralBorder: "rgba(128, 128, 128, 0.2)",
  /** Header row wash in `DataTable` (iOS label gray at 3%). */
  tableHeaderTint: "rgba(60, 60, 67, 0.03)",

  gold: "#FFD700",
} as const;

/**
 * Session platform badge fills. Every value carries white text legibly.
 * The first six are the historical platform colors; `white` is deliberately
 * the iOS gray so a "White" badge still reads. `neutral` is the one general
 * color every platform without a color of its own gets.
 */
export const PlatformPalette = {
  red: "#FF3B30",
  white: "#8E8E93",
  blue: "#007AFF",
  stars: "#AF52DE",
  stripes: "#34C759",
  rogue: "#000000",
  green: "#1E8E3E",
  yellow: "#B08900",
  gold: "#B8860B",
  silver: "#7A7A7F",
  bronze: "#A05A2C",
  orange: "#E8590C",
  purple: "#6F42C1",
  pink: "#D6336C",
  black: "#000000",
  gray: "#6E6E73",
  brown: "#795548",
  teal: "#0B7A75",
  navy: "#1F3A93",
  maroon: "#800000",
  neutral: "#5C6370",
} as const;

/** Medal-colored chip backgrounds (gold / silver / bronze at 15%). */
export const MedalTint = {
  gold: "rgba(255,215,0,0.15)",
  silver: "rgba(192,192,192,0.15)",
  bronze: "rgba(205,127,50,0.15)",
} as const;

/** White at a fixed opacity, keyed by percent, for dark surfaces. */
export const WhiteAlpha = {
  5: "rgba(255,255,255,0.05)",
  6: "rgba(255,255,255,0.06)",
  7: "rgba(255,255,255,0.07)",
  8: "rgba(255,255,255,0.08)",
  10: "rgba(255,255,255,0.1)",
  15: "rgba(255,255,255,0.15)",
  18: "rgba(255,255,255,0.18)",
  20: "rgba(255,255,255,0.2)",
  25: "rgba(255,255,255,0.25)",
  30: "rgba(255,255,255,0.3)",
  35: "rgba(255,255,255,0.35)",
  40: "rgba(255,255,255,0.4)",
  50: "rgba(255,255,255,0.5)",
  60: "rgba(255,255,255,0.6)",
  70: "rgba(255,255,255,0.7)",
  80: "rgba(255,255,255,0.8)",
  85: "rgba(255,255,255,0.85)",
  95: "rgba(255,255,255,0.95)",
} as const;

/** Black at a fixed opacity, keyed by percent: scrims and dimmed chrome. */
export const BlackAlpha = {
  15: "rgba(0,0,0,0.15)",
  25: "rgba(0,0,0,0.25)",
  40: "rgba(0,0,0,0.4)",
  45: "rgba(0,0,0,0.45)",
  50: "rgba(0,0,0,0.5)",
} as const;

/** Weightlifting Wrapped: the fixed-dark story screens. */
export const WrappedPalette = {
  /** Wrapped's green (the same value as the theme's `wrappedPrimary`). */
  green: "#1DB954",
  offlineBannerBackground: "rgba(255,165,0,0.2)",
  offlineBannerBorder: "rgba(255,165,0,0.4)",
} as const;

/** The club meet recap share card, always rendered dark. */
export const RecapCardPalette = {
  background: "#0A0A0F",
} as const;

/** Share image preview: checkerboard behind transparent exports. */
export const SharePreviewPalette = {
  checkerLight: "#F0F0F0",
  checkerDark: "#D8D8D8",
  transparentCardBorder: "#DADADA",
} as const;
