import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { useAppColors } from "@/hooks/useAppColors";
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
import {
  pillRowContentStyle,
  PillContent,
  ResetPill,
} from "./FilterPillButton";
import type { FilterPillBarProps, PillFilterConfig } from "./FilterPillTypes";

type AnchoredMenu = {
  config: PillFilterConfig;
  anchor: LayoutRectangle;
};

const MENU_MAX_HEIGHT_RATIO = 0.45;
const MENU_WIDTH = 240;

/**
 * Default / Android filter pill bar. Uses a custom anchored dropdown menu.
 * iOS uses FilterPillBar.ios.tsx which renders the native UIMenu (liquid glass).
 */
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

  const handlePillPress = useCallback((config: PillFilterConfig) => {
    if (config.onPress) {
      config.onPress();
      return;
    }
    const node = pillRefs.current[config.id];
    if (!node) return;
    node.measureInWindow((x, y, width, height) => {
      setActiveMenu({ config, anchor: { x, y, width, height } });
    });
  }, []);

  const handleMenuSelect = useCallback(
    (value: string) => {
      if (activeMenu) {
        onSelect(activeMenu.config.id, value);
      }
      setActiveMenu(null);
    },
    [activeMenu, onSelect],
  );

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
        testID="filter-pill-bar"
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={pillRowContentStyle}
        keyboardShouldPersistTaps="handled"
      >
        {hasActiveFilters && onReset && <ResetPill onPress={onReset} />}
        {configs.map((config) => (
          <View
            key={config.id}
            ref={(node) => {
              pillRefs.current[config.id] = node;
            }}
            collapsable={false}
          >
            <Pressable
              testID={`filter-pill-${config.id}`}
              onPress={() => handlePillPress(config)}
              style={({ pressed }) => [pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel={`Filter by ${config.label}`}
            >
              <PillContent config={config} />
            </Pressable>
          </View>
        ))}
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
      testID={`filter-option-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}
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
