import { IconSymbol } from "@/components/ui/IconSymbol";
import { MaterialSurface } from "@/components/ui/MaterialSurface";
import { ThemedText } from "@/components/ui/ThemedText";
import { useAppColors } from "@/hooks/useAppColors";
import { getChevronIcon, getCloseIcon } from "@/lib/start-list-utils";
import { ActionModalProps } from "@/types/start-list";
import * as Haptics from "expo-haptics";
import React from "react";
import { Modal, Platform, Pressable, StyleSheet, View } from "react-native";

const selectionHaptic = () => {
  if (process.env.EXPO_OS === "ios") {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
};

const ActionModal: React.FC<ActionModalProps> = ({
  visible,
  onClose,
  athleteCount,
  isSubscribed,
  onSaveAll,
  onSaveToCalendar,
  onCreateShareableSchedule,
  onDownloadShareableSchedule,
}) => {
  const colors = useAppColors();

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={[
          styles.modalOverlay,
          { backgroundColor: colors.modalBackground },
        ]}
        onPress={onClose}
      >
        <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
          <MaterialSurface
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            fallbackColor={colors.card}
            intensity={64}
          />
          <View
            style={[
              styles.saveModalHeader,
              { borderBottomColor: colors.border },
            ]}
          >
            <ThemedText style={[styles.saveModalTitle, { color: colors.text }]}>
              Save{" "}
              {athleteCount}
              {" "}
              Athletes
            </ThemedText>
            <Pressable
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

          <Pressable
            style={({ pressed }) => [
              styles.saveOption,
              { borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed },
            ]}
            onPress={() => {
              selectionHaptic();
              onClose();
              onSaveAll();
            }}
          >
            <View style={styles.saveOptionContent}>
              <IconSymbol name="bookmark" size={22} color={colors.text} />
              <View style={styles.saveOptionText}>
                <ThemedText
                  style={[styles.saveOptionTitle, { color: colors.text }]}
                >
                  Add to Saved
                </ThemedText>
                <ThemedText
                  style={[
                    styles.saveOptionSubtitle,
                    { color: colors.secondaryText },
                  ]}
                >
                  Save sessions to your list
                </ThemedText>
              </View>
            </View>
            <IconSymbol
              name={getChevronIcon("right")}
              size={16}
              color={colors.secondaryText}
            />
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.saveOption,
              { borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed },
            ]}
            onPress={() => {
              selectionHaptic();
              onClose();
              onSaveToCalendar();
            }}
          >
            <View style={styles.saveOptionContent}>
              <IconSymbol
                name="calendar"
                size={22}
                color={!isSubscribed ? colors.secondaryText : colors.text}
              />
              <View style={styles.saveOptionText}>
                <ThemedText
                  style={[
                    styles.saveOptionTitle,
                    {
                      color: !isSubscribed ? colors.secondaryText : colors.text,
                    },
                  ]}
                >
                  Add to Calendar
                </ThemedText>
                <ThemedText
                  style={[
                    styles.saveOptionSubtitle,
                    { color: colors.secondaryText },
                  ]}
                >
                  Save sessions to your calendar
                </ThemedText>
              </View>
            </View>
            <IconSymbol
              name={getChevronIcon("right")}
              size={16}
              color={colors.secondaryText}
            />
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.saveOption,
              { borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed },
            ]}
            onPress={() => {
              selectionHaptic();
              onClose();
              onCreateShareableSchedule();
            }}
          >
            <View style={styles.saveOptionContent}>
              <IconSymbol
                name={
                  Platform.select({
                    ios: "photo",
                    android: "image",
                  }) || "photo"
                }
                size={22}
                color={!isSubscribed ? colors.secondaryText : colors.text}
              />
              <View style={styles.saveOptionText}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <ThemedText
                    style={[
                      styles.saveOptionTitle,
                      {
                        color: !isSubscribed
                          ? colors.secondaryText
                          : colors.text,
                      },
                    ]}
                  >
                    Create Shareable Schedule
                  </ThemedText>
                  {!isSubscribed && (
                    <IconSymbol
                      name={
                        Platform.select({
                          ios: "lock.fill",
                          android: "lock",
                        }) || "lock.fill"
                      }
                      size={14}
                      color={colors.secondaryText}
                    />
                  )}
                </View>
                <ThemedText
                  style={[
                    styles.saveOptionSubtitle,
                    { color: colors.secondaryText },
                  ]}
                >
                  {isSubscribed
                    ? "Generate an image to share"
                    : "Pro feature - Upgrade to access"}
                </ThemedText>
              </View>
            </View>
            <IconSymbol
              name={getChevronIcon("right")}
              size={16}
              color={colors.secondaryText}
            />
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.saveOption,
              { borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed },
            ]}
            onPress={() => {
              selectionHaptic();
              onClose();
              onDownloadShareableSchedule();
            }}
          >
            <View style={styles.saveOptionContent}>
              <IconSymbol
                name={
                  Platform.select({
                    ios: "square.and.arrow.down",
                    android: "download",
                  }) || "square.and.arrow.down"
                }
                size={22}
                color={!isSubscribed ? colors.secondaryText : colors.text}
              />
              <View style={styles.saveOptionText}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <ThemedText
                    style={[
                      styles.saveOptionTitle,
                      {
                        color: !isSubscribed
                          ? colors.secondaryText
                          : colors.text,
                      },
                    ]}
                  >
                    Download Shareable Schedule
                  </ThemedText>
                  {!isSubscribed && (
                    <IconSymbol
                      name={
                        Platform.select({
                          ios: "lock.fill",
                          android: "lock",
                        }) || "lock.fill"
                      }
                      size={14}
                      color={colors.secondaryText}
                    />
                  )}
                </View>
                <ThemedText
                  style={[
                    styles.saveOptionSubtitle,
                    { color: colors.secondaryText },
                  ]}
                >
                  {isSubscribed
                    ? "Export the schedule as a CSV file"
                    : "Pro feature - Upgrade to access"}
                </ThemedText>
              </View>
            </View>
            <IconSymbol
              name={getChevronIcon("right")}
              size={16}
              color={colors.secondaryText}
            />
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

export default ActionModal;

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
  },
  modalContent: {
    borderRadius: 12,
    overflow: "hidden",
    marginHorizontal: 16,
    maxHeight: "80%",
  },
  saveModalHeader: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    position: "relative",
  },
  closeButton: {
    position: "absolute",
    right: 16,
    top: 16,
    padding: 4,
    zIndex: 1,
  },
  saveModalTitle: {
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  saveOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  saveOptionContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  saveOptionText: {
    gap: 4,
  },
  saveOptionTitle: {
    fontSize: 17,
    fontWeight: "400",
  },
  saveOptionSubtitle: {
    fontSize: 13,
  },
});
