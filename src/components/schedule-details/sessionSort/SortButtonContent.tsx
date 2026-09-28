import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { useAppColors } from "@/hooks/useAppColors";
import React from "react";
import { StyleSheet, View } from "react-native";

interface SortButtonContentProps {
  isSubscribed: boolean;
  sortLabel: string;
}

/**
 * The visible sort button (icon + label). Shared between the iOS native menu
 * and the Android custom modal.
 */
export const SortButtonContent: React.FC<SortButtonContentProps> = ({
  isSubscribed,
  sortLabel,
}) => {
  const colors = useAppColors();
  return (
    <View style={styles.sortButton}>
      <IconSymbol
        name={isSubscribed ? "arrow.up.arrow.down" : "lock"}
        size={18}
        color={isSubscribed ? colors.text : colors.secondaryText}
      />
      <ThemedText
        style={[
          styles.sortLabel,
          { color: isSubscribed ? colors.text : colors.secondaryText },
        ]}
      >
        {sortLabel}
      </ThemedText>
    </View>
  );
};

const styles = StyleSheet.create({
  sortButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  sortLabel: {
    fontSize: 13,
    fontWeight: "500",
  },
});
