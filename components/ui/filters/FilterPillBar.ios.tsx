import { MenuView, type MenuAction } from "@react-native-menu/menu";
import React, { useCallback } from "react";
import { Pressable, ScrollView, View } from "react-native";
import {
  pillRowContentStyle,
  PillContent,
  ResetPill,
} from "./FilterPillButton";
import type { FilterPillBarProps, PillFilterConfig } from "./FilterPillTypes";

const ALL_ACTION_ID = "__all__";

/**
 * iOS filter pill bar. Renders the native UIMenu, which automatically adopts
 * the iOS 26 liquid glass styling on supported devices.
 */
const FilterPillBar: React.FC<FilterPillBarProps> = ({
  configs,
  onSelect,
  hasActiveFilters,
  onReset,
}) => {
  const buildActions = useCallback(
    (config: PillFilterConfig): MenuAction[] => {
      const actions: MenuAction[] = [];
      if (config.allOptionLabel !== undefined) {
        actions.push({
          id: ALL_ACTION_ID,
          title: config.allOptionLabel,
          state: config.value === "" ? "on" : "off",
        });
      }
      config.options.forEach((option) => {
        actions.push({
          id: option.value,
          title: option.label,
          state: config.value === option.value ? "on" : "off",
        });
      });
      return actions;
    },
    [],
  );

  return (
    <ScrollView
      testID="filter-pill-bar"
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={pillRowContentStyle}
      keyboardShouldPersistTaps="handled"
    >
      {hasActiveFilters && onReset && <ResetPill onPress={onReset} />}
      {configs.map((config) => {
        // Club (and any pill with a custom onPress) opens its own modal
        // instead of a native menu.
        if (config.onPress) {
          return (
            <Pressable
              key={config.id}
              testID={`filter-pill-${config.id}`}
              onPress={config.onPress}
              style={({ pressed }) => [pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel={`Filter by ${config.label}`}
            >
              <PillContent config={config} />
            </Pressable>
          );
        }

        return (
          <MenuView
            key={config.id}
            testID={`filter-pill-${config.id}`}
            title={config.label}
            actions={buildActions(config)}
            onPressAction={({ nativeEvent }) => {
              const value =
                nativeEvent.event === ALL_ACTION_ID ? "" : nativeEvent.event;
              onSelect(config.id, value);
            }}
          >
            <View accessibilityLabel={`Filter by ${config.label}`}>
              <PillContent config={config} />
            </View>
          </MenuView>
        );
      })}
    </ScrollView>
  );
};

export default FilterPillBar;
