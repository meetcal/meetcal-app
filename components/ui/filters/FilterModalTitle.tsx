import { useAppColors } from "@/hooks/useAppColors";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { IconSymbol } from "../IconSymbol";
import { ThemedText } from "../ThemedText";

interface FilterModalTitleProps {
  title: string;
  value: string;
  onPress: () => void;
  icon: string;
}

const FilterModalTitle = ({
  title,
  value,
  onPress,
  icon,
}: FilterModalTitleProps) => {
  const colors = useAppColors();
  return (
    <Pressable
      style={({ pressed }) => [
        styles.filterSectionButton,
        { borderBottomColor: colors.border },
        pressed && { opacity: 0.8 },
      ]}
      onPress={() => onPress()}
    >
      <View style={styles.filterSectionButtonContent}>
        <View>
          <ThemedText
            style={[styles.filterSectionLabel, { color: colors.secondaryText }]}
          >
            {title}
          </ThemedText>
          <ThemedText
            style={[styles.filterSectionValue, { color: colors.text }]}
          >
            {value}
          </ThemedText>
        </View>
        <IconSymbol name={icon} size={16} color={colors.secondaryText} />
      </View>
    </Pressable>
  );
};

export default FilterModalTitle;

const styles = StyleSheet.create({
  filterSectionButton: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterSectionButtonContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  filterSectionLabel: {
    fontSize: 13,
    marginBottom: 4,
  },
  filterSectionValue: {
    fontSize: 17,
    fontWeight: "400",
  },
});
