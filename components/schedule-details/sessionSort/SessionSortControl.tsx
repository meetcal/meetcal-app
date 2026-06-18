import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { useAppColors } from "@/hooks/useAppColors";
import React, { useCallback, useState } from "react";
import { Modal, Pressable, StyleSheet } from "react-native";
import { SortButtonContent } from "./SortButtonContent";
import type { SessionSortControlProps } from "./types";

/**
 * Default / Android session sort control. Uses a custom modal so the Android
 * experience is unchanged. iOS uses SessionSortControl.ios.tsx which renders
 * the native UIMenu (liquid glass).
 */
const SessionSortControl: React.FC<SessionSortControlProps> = ({
  isSubscribed,
  sortLabel,
  sortKey,
  sortDirection,
  sortOptions,
  onSelect,
  onLockedPress,
}) => {
  const colors = useAppColors();
  const [sortModalVisible, setSortModalVisible] = useState(false);

  const handlePress = useCallback(() => {
    if (!isSubscribed) {
      onLockedPress();
      return;
    }
    setSortModalVisible(true);
  }, [isSubscribed, onLockedPress]);

  const handleSelect = useCallback(
    (key: typeof sortKey, direction: typeof sortDirection) => {
      onSelect(key, direction);
      setSortModalVisible(false);
    },
    [onSelect],
  );

  return (
    <>
      <Pressable
        style={({ pressed }) => [pressed && isSubscribed && { opacity: 0.8 }]}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel="Sort athletes"
      >
        <SortButtonContent isSubscribed={isSubscribed} sortLabel={sortLabel} />
      </Pressable>

      <Modal
        visible={sortModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSortModalVisible(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setSortModalVisible(false)}
        >
          <Pressable style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <ThemedText style={[styles.modalTitle, { color: colors.text }]}>
              Sort Athletes
            </ThemedText>
            {sortOptions.map((option) => {
              const isSelected =
                option.key === sortKey && option.direction === sortDirection;
              return (
                <Pressable
                  key={`${option.key}-${option.direction}`}
                  style={({ pressed }) => [
                    styles.modalOption,
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => handleSelect(option.key, option.direction)}
                >
                  <ThemedText
                    style={[styles.modalOptionText, { color: colors.text }]}
                  >
                    {option.label}
                  </ThemedText>
                  {isSelected ? (
                    <IconSymbol name="checkmark" size={16} color={colors.link} />
                  ) : null}
                </Pressable>
              );
            })}
            <Pressable
              style={({ pressed }) => [
                styles.modalCancel,
                pressed && { opacity: 0.7 },
              ]}
              onPress={() => setSortModalVisible(false)}
            >
              <ThemedText
                style={[styles.modalCancelText, { color: colors.secondaryText }]}
              >
                Cancel
              </ThemedText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};

export default SessionSortControl;

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  modalCard: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "600",
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  modalOptionText: {
    fontSize: 15,
    fontWeight: "500",
  },
  modalCancel: {
    marginTop: 8,
    alignItems: "center",
    paddingVertical: 8,
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
