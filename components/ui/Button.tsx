import { Radius, Spacing, Type } from "@/constants/Layout";
import { useAppColors } from "@/hooks/useAppColors";
import * as Haptics from "expo-haptics";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

type ButtonVariant = "primary" | "secondary" | "destructive";
type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = Omit<PressableProps, "style"> & {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  /** Optional element rendered before the title (e.g. an IconSymbol). */
  icon?: React.ReactNode;
  fullWidth?: boolean;
  style?: ViewStyle;
};

const SIZES: Record<
  ButtonSize,
  { paddingVertical: number; paddingHorizontal: number; fontSize: number }
> = {
  sm: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, fontSize: 14 },
  md: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg, fontSize: 15 },
  lg: { paddingVertical: Spacing.lg, paddingHorizontal: Spacing.xl, fontSize: 17 },
};

export function Button({
  title,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  icon,
  fullWidth = false,
  style,
  onPress,
  ...rest
}: ButtonProps) {
  const colors = useAppColors();
  const scale = useSharedValue(1);

  const isDisabled = disabled || loading;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const { backgroundColor, textColor, borderColor, borderWidth } =
    getVariantColors(variant, colors);

  const sizeConfig = SIZES[size];

  return (
    <Animated.View style={[fullWidth && styles.fullWidth, animatedStyle]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        disabled={isDisabled}
        onPressIn={(ev) => {
          scale.value = withSpring(0.96, { damping: 15, stiffness: 300 });
          if (process.env.EXPO_OS === "ios") {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
          rest.onPressIn?.(ev);
        }}
        onPressOut={(ev) => {
          scale.value = withSpring(1, { damping: 15, stiffness: 300 });
          rest.onPressOut?.(ev);
        }}
        onPress={onPress}
        style={[
          styles.base,
          {
            backgroundColor,
            borderColor,
            borderWidth,
            paddingVertical: sizeConfig.paddingVertical,
            paddingHorizontal: sizeConfig.paddingHorizontal,
          },
          fullWidth && styles.fullWidth,
          isDisabled && styles.disabled,
          style,
        ]}
        {...rest}
      >
        {loading ? (
          <ActivityIndicator color={textColor} size="small" />
        ) : (
          <View style={styles.content}>
            {icon ? <View style={styles.icon}>{icon}</View> : null}
            <Text
              style={[
                styles.text,
                { color: textColor, fontSize: sizeConfig.fontSize },
              ]}
              numberOfLines={1}
            >
              {title}
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

function getVariantColors(
  variant: ButtonVariant,
  colors: ReturnType<typeof useAppColors>,
) {
  switch (variant) {
    case "secondary":
      return {
        backgroundColor: colors.card,
        textColor: colors.text,
        borderColor: colors.border,
        borderWidth: StyleSheet.hairlineWidth,
      };
    case "destructive":
      return {
        backgroundColor: colors.danger,
        textColor: "#FFFFFF",
        borderColor: "transparent",
        borderWidth: 0,
      };
    case "primary":
    default:
      return {
        backgroundColor: colors.link,
        textColor: "#FFFFFF",
        borderColor: "transparent",
        borderWidth: 0,
      };
  }
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  fullWidth: {
    width: "100%",
  },
  disabled: {
    opacity: 0.5,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
  },
  icon: {
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    ...Type.label,
    textAlign: "center",
  },
});
