import { Radius, Shadows, Spacing } from "@/constants/Layout";
import { useAppColors } from "@/hooks/useAppColors";
import React from "react";
import { StyleSheet, View, type ViewProps } from "react-native";

export type CardProps = ViewProps & {
  /** Apply the de-facto card drop shadow. Defaults to true. */
  elevated?: boolean;
  /** Apply default interior padding (Spacing.lg). Defaults to true. */
  padded?: boolean;
};

export function Card({
  elevated = true,
  padded = true,
  style,
  children,
  ...rest
}: CardProps) {
  const colors = useAppColors();

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card },
        padded && styles.padded,
        elevated && Shadows.card,
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.md,
  },
  padded: {
    padding: Spacing.lg,
  },
});
