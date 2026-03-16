import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
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
  description: string;
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
        <ThemedText
          style={[styles.description, { color: colors.secondaryText }]}
        >
          {description}
        </ThemedText>
      </View>
      <View style={styles.valueContainer}>
        {!!value && (
          <ThemedText style={[styles.value, { color: colors.secondaryText }]}>
            {value}
          </ThemedText>
        )}
        <IconSymbol
          name="chevron-forward"
          size={20}
          color={colors.link}
        />
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
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    maxWidth: "45%",
  },
  value: {
    fontSize: 14,
    textAlign: "right",
  },
});
