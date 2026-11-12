import { useColorScheme } from "@/hooks/useColorScheme";
import { BlurView } from "expo-blur";
import React from "react";
import { Platform, View } from "react-native";

import type { MaterialSurfaceProps } from "./MaterialSurface.types";

/**
 * Cross-platform frosted material surface. Android uses expo-blur's BlurView;
 * iOS uses expo-glass-effect's GlassView (see MaterialSurface.ios.tsx). Both
 * fall back to a solid themed color when the native material is unavailable so
 * call sites stay platform-agnostic.
 */
export function MaterialSurface({
  fallbackColor,
  intensity = 40,
  style,
  children,
  ...rest
}: MaterialSurfaceProps) {
  const scheme = useColorScheme();

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
      tint={scheme === "dark" ? "dark" : "light"}
      intensity={intensity}
      blurMethod="dimezisBlurView"
      {...rest}
    >
      {children}
    </BlurView>
  );
}
