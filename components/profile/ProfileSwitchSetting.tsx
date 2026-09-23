import { useAppColors } from "@/hooks/useAppColors";
import React from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import { IconSymbol } from "../ui/IconSymbol";
import { ThemedText } from "../ui/ThemedText";

interface ProfileSwitchSettingProps {
  label: string;
  description: string;
  value: boolean;
  /** Fired by both the row press and the switch itself. */
  onToggle: () => void;
  showPremiumBadge?: boolean;
  switchDisabled?: boolean;
  isLoading?: boolean;
}

export function ProfileSwitchSetting({
  label,
  description,
  value,
  onToggle,
  showPremiumBadge = false,
  switchDisabled = false,
  isLoading = false,
}: ProfileSwitchSettingProps) {
  const colors = useAppColors();

  return (
    <Pressable
      style={({ pressed }) => [
        styles.container,
        { borderBottomColor: colors.border },
        pressed && { backgroundColor: colors.pressed },
      ]}
      onPress={onToggle}
      disabled={isLoading}
    >
      <View style={styles.row}>
        <View style={styles.textContainer}>
          <ThemedText style={[styles.label, { color: colors.text }]}>
            {label}
            {" "}
            {showPremiumBadge && (
              <IconSymbol name="crown.fill" size={16} color="#FFD700" />
            )}
          </ThemedText>
          <ThemedText
            style={[styles.description, { color: colors.secondaryText }]}
          >
            {description}
          </ThemedText>
        </View>
        <Switch
          trackColor={{ false: "#767577", true: "#81b0ff" }}
          thumbColor={"#f4f3f4"}
          ios_backgroundColor="#3e3e3e"
          onValueChange={onToggle}
          value={value}
          disabled={switchDisabled || isLoading}
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
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  textContainer: {
    flex: 1,
    marginRight: 8,
  },
  label: {
    fontSize: 17,
    fontWeight: "400",
    marginBottom: 4,
  },
  description: {
    fontSize: 14,
  },
});
