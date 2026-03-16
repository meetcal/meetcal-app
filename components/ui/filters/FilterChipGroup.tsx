import { useAppColors } from "@/hooks/useAppColors";
import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { ThemedText } from "../ThemedText";
import type { FilterOption } from "./GenericFilterModal";

interface FilterChipGroupProps {
  title: string;
  options: FilterOption[];
  selectedValue: string;
  onSelect: (value: string) => void;
  allOptionLabel?: string;
}

const FilterChipGroup = ({
  title,
  options,
  selectedValue,
  onSelect,
  allOptionLabel,
}: FilterChipGroupProps) => {
  const colors = useAppColors();

  const chips: { value: string; label: string }[] = [];
  if (allOptionLabel) {
    chips.push({ value: "", label: allOptionLabel });
  }
  chips.push(...options.map((o) => ({ value: o.value, label: o.label })));

  return (
    <View style={styles.container}>
      <ThemedText style={[styles.title, { color: colors.secondaryText }]}>
        {title}
      </ThemedText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        bounces={false}
      >
        {chips.map((chip) => {
          const isSelected = selectedValue === chip.value;
          return (
            <Pressable
              key={chip.value || "__all__"}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: isSelected
                    ? colors.link
                    : colors.borderBottom,
                  borderColor: isSelected ? colors.link : colors.border,
                },
                pressed && { opacity: 0.7 },
              ]}
              onPress={() => onSelect(chip.value)}
            >
              <ThemedText
                style={[
                  styles.chipText,
                  { color: isSelected ? "#FFFFFF" : colors.text },
                  isSelected && styles.chipTextSelected,
                ]}
                numberOfLines={1}
              >
                {chip.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
};

export default FilterChipGroup;

const styles = StyleSheet.create({
  container: {
    paddingVertical: 10,
  },
  title: {
    fontSize: 13,
    marginBottom: 6,
    paddingHorizontal: 16,
  },
  chipRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 14,
    fontWeight: "500",
  },
  chipTextSelected: {
    fontWeight: "600",
  },
});
