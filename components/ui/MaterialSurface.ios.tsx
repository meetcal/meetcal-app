import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import React from "react";
import { View, type ViewProps } from "react-native";

export interface MaterialSurfaceProps extends ViewProps {
  /** Solid color rendered when Liquid Glass is unavailable. */
  fallbackColor: string;
  /** Overrides the auto-resolved appearance. Maps to GlassView colorScheme. */
  tint?: "light" | "dark";
  /** Android blur intensity. Ignored on iOS. */
  intensity?: number;
  /** iOS glass style. */
  glassStyle?: "regular" | "clear";
}

/**
 * iOS frosted material surface backed by expo-glass-effect's Liquid Glass.
 * Requires iOS 26+; on older systems (isLiquidGlassAvailable() === false) it
 * falls back to a solid themed color so text contrast is preserved.
 */
export function MaterialSurface({
  fallbackColor,
  tint,
  intensity: _intensity,
  glassStyle = "regular",
  style,
  children,
  ...rest
}: MaterialSurfaceProps) {
  if (!isLiquidGlassAvailable()) {
    return (
      <View style={[style, { backgroundColor: fallbackColor }]} {...rest}>
        {children}
      </View>
    );
  }

  return (
    <GlassView
      style={style}
      glassEffectStyle={glassStyle}
      colorScheme={tint ?? "auto"}
      {...rest}
    >
      {children}
    </GlassView>
  );
}
