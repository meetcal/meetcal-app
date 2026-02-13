import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { useAppColors } from "@/hooks/useAppColors";
import {
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

interface Meet {
  name: string;
  dates?: {
    start: string;
    end?: string;
  };
}

interface MeetSelectionModalProps {
  visible: boolean;
  onClose: () => void;
  meets: Meet[];
  selectedMeet: string | null;
  onSelectMeet: (meetName: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  isRefreshing: boolean;
}

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

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={[
          styles.modalOverlay,
          {
            backgroundColor: colors.modalBackground,
          },
        ]}
        onPress={onClose}
      >
        <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
          <View
            style={[styles.modalHeader, { borderBottomColor: colors.border }]}
          >
            <ThemedText style={[styles.modalTitle, { color: colors.text }]}>
              Select Your Meet
            </ThemedText>
            <Pressable
              style={({ pressed }) => [
                styles.closeButton,
                pressed && { opacity: 0.8 },
              ]}
              onPress={onClose}
            >
              <IconSymbol
                name={Platform.OS === "ios" ? "xmark" : "close"}
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
                key={meet.name}
                style={({ pressed }) => [
                  styles.modalOption,
                  { borderBottomColor: colors.border },
                  selectedMeet === meet.name && {
                    backgroundColor: colors.pressed,
                  },
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => onSelectMeet(meet.name)}
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
                <ThemedText style={styles.emptyText}>
                  No meets available in the next 6 months
                </ThemedText>
              </View>
            )}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    padding: 16,
  },
  modalContent: {
    backgroundColor: "#FFFFFF",
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
    color: "#666",
    textAlign: "center",
  },
  modalScrollView: {
    flexGrow: 0,
  },
  modalScrollContent: {
    flexGrow: 1,
  },
});
