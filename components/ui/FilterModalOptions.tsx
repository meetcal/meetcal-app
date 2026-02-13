import { useAppColors } from "@/hooks/useAppColors";
import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { IconSymbol } from "./IconSymbol";
import { ThemedText } from "./ThemedText";

interface FilterOption {
  value: string;
  label: string;
  icon?: string;
  iconColor?: string;
  rightContent?: React.ReactNode;
}

interface FilterModalOptionsProps {
  options: FilterOption[];
  selectedValue: string;
  onSelect: (value: string) => void;
  maxHeight: number;
  allOptionLabel?: string;
  renderCustomContent?: (option: FilterOption) => React.ReactNode;
}

const FilterModalOptions = ({
  options,
  selectedValue,
  onSelect,
  maxHeight,
  allOptionLabel = "All",
  renderCustomContent,
}: FilterModalOptionsProps) => {
  const colors = useAppColors();

  return (
    <ScrollView
      style={[styles.filterOptions, { maxHeight }]}
      bounces={false}
      nestedScrollEnabled={true}
    >
      {/* "All" option */}
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

      {/* Mapped options */}
      {options.map((option) => (
        <Pressable
          key={option.value}
          style={({ pressed }) => [
            styles.filterOption,
            { borderBottomColor: colors.border },
            selectedValue === option.value && {
              backgroundColor: colors.pressed,
            },
            pressed && { opacity: 0.8 },
          ]}
          onPress={() => onSelect(option.value)}
        >
{renderCustomContent ? (
            renderCustomContent(option)
          ) : (
            <>
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
              {option.rightContent}
              {selectedValue === option.value && !option.rightContent && (
                <IconSymbol name="checkmark" size={16} color={colors.link} />
              )}
            </>
          )}
        </Pressable>
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
  filterOptionContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
});
