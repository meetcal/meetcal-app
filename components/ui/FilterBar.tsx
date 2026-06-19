import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { useAppColors } from "@/hooks/useAppColors";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

interface FilterBarProps {
  displayText: string;
  onPress: () => void;
  testID?: string;
}

export function FilterBar({ displayText, onPress, testID = "filter-bar" }: FilterBarProps) {
  const colors = useAppColors();

  return (
    <View
      style={[
        styles.filterContainer,
        {
          backgroundColor: colors.background,
          borderBottomColor: colors.borderBottom,
          borderBottomWidth: 1,
        },
      ]}
    >
      <View style={styles.filterButtons}>
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel="Open filters"
          style={({ pressed }) => [
            styles.filterButton,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
            pressed && { backgroundColor: colors.pressed },
          ]}
          onPress={onPress}
        >
          <ThemedText
            style={[styles.filterButtonText, { color: colors.secondaryText }]}
          >
            {displayText}
          </ThemedText>
          <IconSymbol
            name="chevron.down"
            size={12}
            color={colors.secondaryText}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  filterContainer: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterButtons: {
    flexDirection: "row",
    gap: 8,
  },
  filterButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    elevation: 1,
  },
  filterButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
