import React from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { IconSymbol } from "../ui/IconSymbol";
import { ThemedText } from "../ui/ThemedText";

interface ProfileActionSettingProps {
  colors: {
    text: string;
    secondaryText: string;
    border: string;
    pressed: string;
    link: string;
  };
  label: string;
  description?: string;
  value?: string;
  onPress: () => void;
  disabled?: boolean;
}

export function ProfileActionSetting({
  colors,
  label,
  description,
  value,
  onPress,
  disabled = false,
}: ProfileActionSettingProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.container,
        { borderBottomColor: colors.border },
        pressed && !disabled && { backgroundColor: colors.pressed },
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={styles.textContainer}>
        <ThemedText style={[styles.label, { color: colors.text }]}>
          {label}
        </ThemedText>
        {!!description && (
          <ThemedText
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[styles.description, { color: colors.secondaryText }]}
          >
            {description}
          </ThemedText>
        )}
      </View>
      <View style={[styles.valueContainer, !value && styles.iconOnlyContainer]}>
        {!!value && (
          <ThemedText
            style={[styles.value, { color: colors.secondaryText }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {value}
          </ThemedText>
        )}
        <View style={styles.chevronContainer}>
          <IconSymbol
            name={Platform.OS === "ios" ? "chevron.right" : "chevron-forward"}
            size={20}
            color={colors.link}
          />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
  },
  textContainer: {
    flex: 1,
    marginRight: 12,
    minWidth: 0,
  },
  label: {
    fontSize: 17,
    fontWeight: "400",
    marginBottom: 4,
  },
  description: {
    fontSize: 14,
  },
  valueContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    justifyContent: "flex-end",
    minWidth: 0,
  },
  iconOnlyContainer: {
    flex: 0,
    width: 20,
  },
  value: {
    flexShrink: 1,
    fontSize: 14,
    textAlign: "right",
  },
  chevronContainer: {
    width: 20,
    alignItems: "flex-end",
    flexShrink: 0,
  },
});
