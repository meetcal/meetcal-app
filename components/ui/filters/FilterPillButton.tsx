import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { useAppColors } from "@/hooks/useAppColors";
import { getChevronIcon } from "@/lib/start-list-utils";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { PillFilterConfig } from "./FilterPillTypes";

export function getPillLabel(config: PillFilterConfig) {
  if (!config.value) return config.label;
  const option = config.options.find((opt) => opt.value === config.value);
  return option?.label ?? config.value;
}

interface PillContentProps {
  config: PillFilterConfig;
}

/** Visual-only pill (label + chevron). */
export const PillContent: React.FC<PillContentProps> = ({ config }) => {
  const colors = useAppColors();
  const isActive = Boolean(config.value);
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: isActive ? colors.link : colors.card,
          borderColor: isActive ? colors.link : colors.border,
        },
      ]}
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
    </View>
  );
};

interface ResetPillProps {
  onPress: () => void;
}

export const ResetPill: React.FC<ResetPillProps> = ({ onPress }) => {
  const colors = useAppColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.resetPill,
        { backgroundColor: colors.card, borderColor: colors.border },
        pressed && { opacity: 0.7 },
      ]}
      accessibilityRole="button"
      accessibilityLabel="Clear all filters"
    >
      <IconSymbol name="xmark" size={13} color={colors.text} />
    </Pressable>
  );
};

export const pillRowContentStyle = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: 8,
  paddingHorizontal: 16,
  paddingVertical: 2,
};

const styles = StyleSheet.create({
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
});
