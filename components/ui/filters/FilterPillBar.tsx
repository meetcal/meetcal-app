import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { useAppColors } from "@/hooks/useAppColors";
import { getChevronIcon } from "@/lib/start-list-utils";
import React, { useCallback, useRef, useState } from "react";
import {
  LayoutRectangle,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export interface PillFilterOption {
  value: string;
  label: string;
}

export interface PillFilterConfig {
  /** Unique id, matches the filter key */
  id: string;
  /** Label shown on the pill when no value is selected */
  label: string;
  /** Currently selected value ("" means no selection) */
  value: string;
  /** Options shown in the dropdown menu */
  options: PillFilterOption[];
  /** Label for the "clear"/all option at the top of the menu */
  allOptionLabel?: string;
  /**
   * When provided, tapping the pill calls this handler instead of opening the
   * inline dropdown (used for Club which needs a searchable popup).
   */
  onPress?: () => void;
}

interface FilterPillBarProps {
  configs: PillFilterConfig[];
  onSelect: (id: string, value: string) => void;
  hasActiveFilters?: boolean;
  onReset?: () => void;
}

type AnchoredMenu = {
  config: PillFilterConfig;
  anchor: LayoutRectangle;
};

const MENU_MAX_HEIGHT_RATIO = 0.45;
const MENU_WIDTH = 240;

const FilterPillBar: React.FC<FilterPillBarProps> = ({
  configs,
  onSelect,
  hasActiveFilters,
  onReset,
}) => {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [activeMenu, setActiveMenu] = useState<AnchoredMenu | null>(null);
  const pillRefs = useRef<Record<string, View | null>>({});

  const getPillLabel = useCallback((config: PillFilterConfig) => {
    if (!config.value) return config.label;
    const option = config.options.find((opt) => opt.value === config.value);
    return option?.label ?? config.value;
  }, []);

  const handlePillPress = useCallback(
    (config: PillFilterConfig) => {
      if (config.onPress) {
        config.onPress();
        return;
      }
      const node = pillRefs.current[config.id];
      if (!node) return;
      node.measureInWindow((x, y, width, height) => {
        setActiveMenu({ config, anchor: { x, y, width, height } });
      });
    },
    [],
  );

  const handleMenuSelect = useCallback(
    (value: string) => {
      if (activeMenu) {
        onSelect(activeMenu.config.id, value);
      }
      setActiveMenu(null);
    },
    [activeMenu, onSelect],
  );

  // Compute the dropdown position so it stays on-screen.
  const menuPosition = (() => {
    if (!activeMenu) return null;
    const { anchor } = activeMenu;
    const top = anchor.y + anchor.height + 6;
    let left = anchor.x;
    if (left + MENU_WIDTH > windowWidth - 12) {
      left = windowWidth - 12 - MENU_WIDTH;
    }
    if (left < 12) left = 12;
    const maxHeight = Math.min(
      windowHeight * MENU_MAX_HEIGHT_RATIO,
      windowHeight - top - insets.bottom - 16,
    );
    return { top, left, maxHeight };
  })();

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillRow}
        keyboardShouldPersistTaps="handled"
      >
        {hasActiveFilters && onReset && (
          <Pressable
            onPress={onReset}
            style={({ pressed }) => [
              styles.resetPill,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Clear all filters"
          >
            <IconSymbol name="xmark" size={13} color={colors.text} />
          </Pressable>
        )}
        {configs.map((config) => {
          const isActive = Boolean(config.value);
          return (
            <View
              key={config.id}
              ref={(node) => {
                pillRefs.current[config.id] = node;
              }}
              collapsable={false}
            >
              <Pressable
                onPress={() => handlePillPress(config)}
                style={({ pressed }) => [
                  styles.pill,
                  {
                    backgroundColor: isActive ? colors.link : colors.card,
                    borderColor: isActive ? colors.link : colors.border,
                  },
                  pressed && { opacity: 0.7 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Filter by ${config.label}`}
              >
                <ThemedText
                  style={[
                    styles.pillText,
                    { color: isActive ? "#FFFFFF" : colors.text },
                    isActive && styles.pillTextActive,
                  ]}
                  numberOfLines={1}
                >
                  {getPillLabel(config)}
                </ThemedText>
                <IconSymbol
                  name={getChevronIcon("down")}
                  size={12}
                  color={isActive ? "#FFFFFF" : colors.secondaryText}
                />
              </Pressable>
            </View>
          );
        })}
      </ScrollView>

      <Modal
        visible={activeMenu !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveMenu(null)}
      >
        <Pressable
          style={styles.menuBackdrop}
          onPress={() => setActiveMenu(null)}
        />
        {activeMenu && menuPosition && (
          <View
            style={[
              styles.menu,
              {
                top: menuPosition.top,
                left: menuPosition.left,
                width: MENU_WIDTH,
                maxHeight: menuPosition.maxHeight,
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {activeMenu.config.allOptionLabel !== undefined && (
                <MenuRow
                  label={activeMenu.config.allOptionLabel}
                  selected={activeMenu.config.value === ""}
                  onPress={() => handleMenuSelect("")}
                />
              )}
              {activeMenu.config.options.map((option) => (
                <MenuRow
                  key={option.value}
                  label={option.label}
                  selected={activeMenu.config.value === option.value}
                  onPress={() => handleMenuSelect(option.value)}
                />
              ))}
            </ScrollView>
          </View>
        )}
      </Modal>
    </>
  );
};

interface MenuRowProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

const MenuRow: React.FC<MenuRowProps> = ({ label, selected, onPress }) => {
  const colors = useAppColors();
  return (
    <Pressable
      style={({ pressed }) => [
        styles.menuRow,
        { borderBottomColor: colors.border },
        selected && { backgroundColor: colors.pressed },
        pressed && { opacity: 0.7 },
      ]}
      onPress={onPress}
    >
      <ThemedText
        style={[
          styles.menuRowText,
          { color: selected ? colors.link : colors.text },
        ]}
        numberOfLines={2}
      >
        {label}
      </ThemedText>
      {selected && <IconSymbol name="checkmark" size={16} color={colors.link} />}
    </Pressable>
  );
};

export default FilterPillBar;

const styles = StyleSheet.create({
  pillRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 2,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 14,
    fontWeight: "500",
  },
  pillTextActive: {
    fontWeight: "600",
  },
  resetPill: {
    alignItems: "center",
    justifyContent: "center",
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
  },
  menuBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "transparent",
  },
  menu: {
    position: "absolute",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  menuRowText: {
    fontSize: 16,
    flex: 1,
  },
});
