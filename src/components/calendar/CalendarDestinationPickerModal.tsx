import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { useAppColors } from "@/hooks/useAppColors";
import { useScreenHorizontalInsets } from "@/hooks/useScreenInsets";
import { CalendarDestination } from "@/utils/calendar";
import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { ToastHost } from "@/components/ui/Toast";

interface CalendarDestinationPickerModalProps {
  visible: boolean;
  title: string;
  destinations: CalendarDestination[];
  selectedId?: string | null;
  onClose: () => void;
  onSelect: (destination: CalendarDestination) => void;
  onClear?: () => void;
  isLoading?: boolean;
}

export function CalendarDestinationPickerModal({
  visible,
  title,
  destinations,
  selectedId,
  onClose,
  onSelect,
  onClear,
  isLoading = false,
}: CalendarDestinationPickerModalProps) {
  const colors = useAppColors();
  const screenInsets = useScreenHorizontalInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={[
          styles.overlay,
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
          style={[styles.content, { backgroundColor: colors.card }]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <ThemedText style={[styles.title, { color: colors.text }]}>
              {title}
            </ThemedText>
            <Pressable
              style={({ pressed }) => [styles.closeButton, pressed && { opacity: 0.7 }]}
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <IconSymbol name="xmark" size={20} color={colors.secondaryText} />
            </Pressable>
          </View>

          {isLoading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color={colors.link} />
            </View>
          ) : (
            <ScrollView style={styles.scrollView}>
              {destinations.length === 0 ? (
                <View style={styles.emptyState}>
                  <ThemedText
                    style={[styles.emptyText, { color: colors.secondaryText }]}
                  >
                    No writable calendars available on this device.
                  </ThemedText>
                </View>
              ) : (
                destinations.map((destination, index) => {
                  const isSelected = destination.id === selectedId;

                  return (
                    <Pressable
                      key={destination.id}
                      style={({ pressed }) => [
                        styles.option,
                        { borderBottomColor: colors.border },
                        pressed && { backgroundColor: colors.pressed },
                      ]}
                      onPress={() => onSelect(destination)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                    >
                      <View style={styles.optionText}>
                        <ThemedText
                          style={[styles.optionTitle, { color: colors.text }]}
                        >
                          {destination.title}
                        </ThemedText>
                        <ThemedText
                          style={[
                            styles.optionSubtitle,
                            { color: colors.secondaryText },
                          ]}
                        >
                          {destination.label}
                        </ThemedText>
                      </View>
                      {isSelected && (
                        <IconSymbol
                          name="checkmark"
                          size={18}
                          color={colors.link}
                        />
                      )}
                      {!isSelected && index === 0 && (
                        <ThemedText
                          style={[
                            styles.recommendedText,
                            { color: colors.secondaryText },
                          ]}
                        >
                          Recommended
                        </ThemedText>
                      )}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          )}

          {onClear && (
            <Pressable
              style={({ pressed }) => [
                styles.clearButton,
                { borderTopColor: colors.border },
                pressed && { backgroundColor: colors.pressed },
              ]}
              onPress={onClear}
            >
              <ThemedText style={[styles.clearText, { color: colors.fail }]}>
                Clear Selection
              </ThemedText>
            </Pressable>
          )}
        </Pressable>
      </Pressable>
      {/* A modal is its own native window above the root toast host: errors
          raised while it is open must show here to be seen. */}
      <ToastHost />
    </Modal>
  );
}

const OVERLAY_PADDING = 20;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    padding: OVERLAY_PADDING,
  },
  content: {
    borderRadius: 16,
    overflow: "hidden",
    maxHeight: "70%",
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
  },
  closeButton: {
    padding: 4,
  },
  scrollView: {
    maxHeight: 360,
  },
  loadingState: {
    paddingVertical: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    padding: 20,
  },
  emptyText: {
    fontSize: 15,
    textAlign: "center",
  },
  option: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  optionText: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: "500",
    marginBottom: 3,
  },
  optionSubtitle: {
    fontSize: 13,
  },
  recommendedText: {
    fontSize: 12,
    fontWeight: "500",
  },
  clearButton: {
    paddingVertical: 14,
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  clearText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
