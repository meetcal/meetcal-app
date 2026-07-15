import { Button, type ButtonProps } from "@/components/ui/Button";
import { Spacing, Type } from "@/constants/Layout";
import { useAppColors } from "@/hooks/useAppColors";
import React from "react";
import {
  Image,
  type ImageSourcePropType,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";

export type EmptyStateProps = {
  title: string;
  message?: string;
  /** An icon element (e.g. an IconSymbol). Ignored when `image` is provided. */
  icon?: React.ReactNode;
  /** An image source, e.g. the MeetCal logo. Takes precedence over `icon`. */
  image?: ImageSourcePropType;
  imageSize?: number;
  /** Convenience: renders a primary Button below the message. */
  actionLabel?: string;
  onActionPress?: () => void;
  actionVariant?: ButtonProps["variant"];
  actionLoading?: boolean;
  /** Full control over the action area. Overrides actionLabel/onActionPress. */
  action?: React.ReactNode;
  style?: ViewStyle;
};

export function EmptyState({
  title,
  message,
  icon,
  image,
  imageSize = 96,
  actionLabel,
  onActionPress,
  actionVariant = "primary",
  actionLoading,
  action,
  style,
}: EmptyStateProps) {
  const colors = useAppColors();

  let actionNode: React.ReactNode = null;
  if (action) {
    actionNode = action;
  } else if (actionLabel && onActionPress) {
    actionNode = (
      <Button
        title={actionLabel}
        onPress={onActionPress}
        variant={actionVariant}
        loading={actionLoading}
      />
    );
  }

  return (
    <View style={[styles.container, style]}>
      {image ? (
        <Image
          source={image}
          style={[styles.image, { width: imageSize, height: imageSize }]}
          resizeMode="contain"
        />
      ) : icon ? (
        <View style={styles.icon}>{icon}</View>
      ) : null}

      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>

      {message ? (
        <Text style={[styles.message, { color: colors.secondaryText }]}>
          {message}
        </Text>
      ) : null}

      {actionNode ? <View style={styles.action}>{actionNode}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xxl,
  },
  image: {
    marginBottom: Spacing.lg,
  },
  icon: {
    marginBottom: Spacing.lg,
  },
  title: {
    ...Type.subtitle,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  message: {
    ...Type.body,
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  action: {
    marginTop: Spacing.xs,
  },
});
