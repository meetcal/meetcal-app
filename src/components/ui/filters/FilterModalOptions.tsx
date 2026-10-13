import { useAppColors } from "@/hooks/useAppColors";
import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { IconSymbol } from "../IconSymbol";
import { ThemedText } from "../ThemedText";

// Structurally the same option `GenericFilterModal` exports; declared here so
// this file does not import from its own parent.
interface FilterOption {
  value: string;
  label: string;
  icon?: string;
  iconColor?: string;
  group?: string;
}

interface FilterModalOptionsProps {
  options: FilterOption[];
  selectedValue: string;
  onSelect: (value: string) => void;
  maxHeight: number;
  allOptionLabel?: string;
}

const FilterModalOptions = ({
  options,
  selectedValue,
  onSelect,
  maxHeight,
  allOptionLabel,
}: FilterModalOptionsProps) => {
  const colors = useAppColors();

  return (
    <ScrollView
      style={[styles.filterOptions, { maxHeight }]}
      bounces={false}
      nestedScrollEnabled={true}
    >
      {/* "All" option - only show if allOptionLabel is provided */}
      {allOptionLabel !== undefined && (
        <Pressable
          style={({ pressed }) => [
            styles.filterOption,
            { borderBottomColor: colors.border },
            selectedValue === "" && {
              backgroundColor: colors.pressed,
            },
            pressed && { opacity: 0.8 },
          ]}
          onPress={() => onSelect("")}
          accessibilityRole="button"
          accessibilityState={{ selected: selectedValue === "" }}
        >
          <ThemedText
            style={[
              styles.filterOptionText,
              { color: colors.text },
              selectedValue === "" && { color: colors.link },
            ]}
          >
            {allOptionLabel}
          </ThemedText>
          {selectedValue === "" && (
            <IconSymbol name="checkmark" size={16} color={colors.link} />
          )}
        </Pressable>
      )}

      {/* Mapped options, a heading before each run of one `group` */}
      {options.map((option, index) => (
        <React.Fragment key={option.value}>
          {option.group && option.group !== options[index - 1]?.group && (
            <View
              accessibilityRole="header"
              style={[styles.groupHeading, { borderBottomColor: colors.border }]}
            >
              <ThemedText
                style={[styles.groupHeadingText, { color: colors.secondaryText }]}
              >
                {option.group}
              </ThemedText>
            </View>
          )}
          <Pressable
            style={({ pressed }) => [
              styles.filterOption,
              { borderBottomColor: colors.border },
              selectedValue === option.value && {
                backgroundColor: colors.pressed,
              },
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => onSelect(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: selectedValue === option.value }}
          >
            {option.icon ? (
              <View style={styles.filterOptionContent}>
                <ThemedText
                  style={[
                    styles.filterOptionText,
                    { color: colors.text },
                    selectedValue === option.value && {
                      color: colors.link,
                    },
                  ]}
                  numberOfLines={2}
                >
                  {option.label}
                </ThemedText>
                <IconSymbol
                  name={option.icon}
                  size={22}
                  color={option.iconColor || colors.secondaryText}
                />
              </View>
            ) : (
              <ThemedText
                style={[
                  styles.filterOptionText,
                  { color: colors.text },
                  selectedValue === option.value && {
                    color: colors.link,
                  },
                ]}
                numberOfLines={2}
              >
                {option.label}
              </ThemedText>
            )}
            {selectedValue === option.value && (
              <IconSymbol name="checkmark" size={16} color={colors.link} />
            )}
          </Pressable>
        </React.Fragment>
      ))}
    </ScrollView>
  );
};

export default FilterModalOptions;

const styles = StyleSheet.create({
  filterOptions: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  filterOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterOptionText: {
    fontSize: 17,
    flex: 1,
    marginRight: 16,
  },
  groupHeading: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  groupHeadingText: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  filterOptionContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
});
