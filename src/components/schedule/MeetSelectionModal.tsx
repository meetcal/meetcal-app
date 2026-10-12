import { IconSymbol } from "@/components/ui/IconSymbol";
import { getCloseIcon } from "@/lib/start-list-utils";
import { MaterialSurface } from "@/components/ui/MaterialSurface";
import { ThemedText } from "@/components/ui/ThemedText";
import { useAppColors } from "@/hooks/useAppColors";
import { UPCOMING_MEETS_MONTHS_RANGE } from "@/hooks/useUpcomingMeets";
import { MeetSelectionModalProps } from "@/types/schedule";
import { lightImpact } from "@/lib/haptics";
import { useState } from "react";
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useScreenHorizontalInsets } from "@/hooks/useScreenInsets";

export function MeetSelectionModal({
  visible,
  onClose,
  meets,
  selectedMeet,
  onSelectMeet,
  onRefresh,
  isRefreshing,
}: MeetSelectionModalProps) {
  const colors = useAppColors();
  const screenInsets = useScreenHorizontalInsets();
  const [isSelecting, setIsSelecting] = useState(false);

  const handleSelectMeet = async (meetName: string) => {
    if (isSelecting) return;
    lightImpact();
    setIsSelecting(true);
    try {
      await onSelectMeet(meetName);
    } catch (error) {
      console.error("Failed to select meet:", error);
    } finally {
      setIsSelecting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        testID="meet-selection-modal-backdrop"
        style={[
          styles.modalOverlay,
          {
            backgroundColor: colors.modalBackground,
            // A modal is above every screen's padding: clear the Duo band here.
            paddingLeft: OVERLAY_PADDING + screenInsets.paddingLeft,
            paddingRight: OVERLAY_PADDING + screenInsets.paddingRight,
          },
        ]}
        onPress={onClose}
      >
        <Pressable
          testID="meet-selection-modal"
          style={styles.modalContent}
          onPress={(e) => e.stopPropagation()}
        >
          <MaterialSurface
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            fallbackColor={colors.card}
            intensity={64}
          />
          <View
            style={[styles.modalHeader, { borderBottomColor: colors.border }]}
          >
            <ThemedText style={[styles.modalTitle, { color: colors.text }]}>
              Select Your Meet
            </ThemedText>
            <Pressable
              testID="meet-selection-close"
              accessibilityRole="button"
              accessibilityLabel="Close meet selector"
              style={({ pressed }) => [
                styles.closeButton,
                pressed && { opacity: 0.8 },
              ]}
              onPress={onClose}
            >
              <IconSymbol
                name={getCloseIcon()}
                size={20}
                color={colors.secondaryText}
              />
            </Pressable>
          </View>

          <ScrollView
            style={styles.modalScrollView}
            contentContainerStyle={styles.modalScrollContent}
            alwaysBounceVertical
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={onRefresh}
                tintColor={colors.text}
              />
            }
          >
            {meets.map((meet) => (
              <Pressable
                key={meet.id}
                testID={`meet-option-${meet.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}
                accessibilityRole="button"
                accessibilityLabel={`Select ${meet.name}`}
                accessibilityState={{
                  selected: selectedMeet === meet.name,
                  disabled: isSelecting,
                }}
                style={({ pressed }) => [
                  styles.modalOption,
                  { borderBottomColor: colors.border },
                  selectedMeet === meet.name && {
                    backgroundColor: colors.pressedTranslucent,
                  },
                  pressed && { opacity: 0.8 },
                ]}
                disabled={isSelecting}
                onPress={() => handleSelectMeet(meet.name)}
              >
                <ThemedText
                  style={[
                    styles.modalOptionText,
                    { color: colors.text },
                    selectedMeet === meet.name && { color: colors.link },
                  ]}
                >
                  {meet.name}
                </ThemedText>
                {selectedMeet === meet.name && (
                  <IconSymbol name="checkmark" size={16} color={colors.link} />
                )}
              </Pressable>
            ))}

            {meets.length === 0 && (
              <View style={styles.emptyContainer}>
                <ThemedText style={[styles.emptyText, { color: colors.secondaryText }]}>
                  {`No meets within ${UPCOMING_MEETS_MONTHS_RANGE} months of today`}
                </ThemedText>
              </View>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const OVERLAY_PADDING = 16;

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    padding: OVERLAY_PADDING,
  },
  modalContent: {
    borderRadius: 12,
    overflow: "hidden",
    marginHorizontal: 16,
    maxHeight: "70%",
  },
  modalHeader: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    position: "relative",
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  closeButton: {
    position: "absolute",
    right: 16,
    top: 16,
    padding: 4,
    zIndex: 1,
  },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalOptionText: {
    fontSize: 17,
    width: "90%",
  },
  emptyContainer: {
    padding: 16,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 16,
    textAlign: "center",
  },
  modalScrollView: {
    flexGrow: 0,
  },
  modalScrollContent: {
    flexGrow: 1,
  },
});
