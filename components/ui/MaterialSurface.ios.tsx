import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect";
import React from "react";
import { View, type ViewProps } from "react-native";

export interface MaterialSurfaceProps extends ViewProps {
  /** Solid color rendered when Liquid Glass is unavailable. */
  fallbackColor: string;
  /** Android blur intensity. Ignored on iOS. */
  intensity?: number;
}

/**
 * iOS frosted material surface backed by expo-glass-effect's Liquid Glass.
 * Requires iOS 26+ AND a runtime glass API (some iOS 26 betas compile Liquid
 * Glass in without the API and crash on GlassView — expo/expo#40911); when
 * either check fails it falls back to a solid themed color so text contrast
 * is preserved.
 */
export function MaterialSurface({
  fallbackColor,
  intensity: _intensity,
  style,
  children,
  ...rest
}: MaterialSurfaceProps) {
  if (!isGlassEffectAPIAvailable() || !isLiquidGlassAvailable()) {
    return (
      <View style={[style, { backgroundColor: fallbackColor }]} {...rest}>
        {children}
      </View>
    );
  }

  return (
    <GlassView
      style={style}
      glassEffectStyle="regular"
      colorScheme="auto"
      {...rest}
    >
      {children}
    </GlassView>
  );
}
