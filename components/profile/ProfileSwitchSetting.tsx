import React from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import { IconSymbol } from "../ui/IconSymbol";
import { ThemedText } from "../ui/ThemedText";

interface ProfileSwitchSettingProps {
  colors: {
    text: string;
    secondaryText: string;
    border: string;
    pressed: string;
  };
  label: string;
  description: string;
  value: boolean;
  onPress: () => void;
  onValueChange: () => void;
  showPremiumBadge?: boolean;
  switchDisabled?: boolean;
  isLoading?: boolean;
}

export function ProfileSwitchSetting({
  colors,
  label,
  description,
  value,
  onPress,
  onValueChange,
  showPremiumBadge = false,
  switchDisabled = false,
  isLoading = false,
}: ProfileSwitchSettingProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.container,
        { borderBottomColor: colors.border },
        pressed && { backgroundColor: colors.pressed },
      ]}
      onPress={onPress}
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
          onValueChange={onValueChange}
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
