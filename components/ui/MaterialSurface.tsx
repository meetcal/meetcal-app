import { useColorScheme } from "@/hooks/useColorScheme";
import { BlurView } from "expo-blur";
import React from "react";
import { Platform, View, type ViewProps } from "react-native";

export interface MaterialSurfaceProps extends ViewProps {
  /** Solid color rendered when a native material effect is unavailable. */
  fallbackColor: string;
  /** Overrides the auto-resolved light/dark appearance. */
  tint?: "light" | "dark";
  /** Android blur intensity (1-100). Ignored on iOS. */
  intensity?: number;
  /** iOS glass style. Ignored on Android. */
  glassStyle?: "regular" | "clear";
}

/**
 * Cross-platform frosted material surface. Android uses expo-blur's BlurView;
 * iOS uses expo-glass-effect's GlassView (see MaterialSurface.ios.tsx). Both
 * fall back to a solid themed color when the native material is unavailable so
 * call sites stay platform-agnostic.
 */
export function MaterialSurface({
  fallbackColor,
  tint,
  intensity = 40,
  glassStyle: _glassStyle,
  style,
  children,
  ...rest
}: MaterialSurfaceProps) {
  const scheme = useColorScheme();
  const resolvedTint = tint ?? (scheme === "dark" ? "dark" : "light");

  // BlurView's real blur is Android-only in this setup; everything else (web,
  // unexpected platforms) renders the solid fallback.
  if (Platform.OS !== "android") {
    return (
      <View style={[style, { backgroundColor: fallbackColor }]} {...rest}>
        {children}
      </View>
    );
  }

  return (
    <BlurView
      style={style}
      tint={resolvedTint}
      intensity={intensity}
      blurMethod="dimezisBlurView"
      {...rest}
    >
      {children}
    </BlurView>
  );
}
