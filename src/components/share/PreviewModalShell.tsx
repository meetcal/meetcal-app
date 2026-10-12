import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { useAppColors } from "@/hooks/useAppColors";
import { useScreenHorizontalInsets } from "@/hooks/useScreenInsets";
import React from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * The page-sheet shell every share preview uses: a centred title, a Done
 * button, and a scrolling body for the preview itself.
 *
 * Android has no page sheet, so the modal is full screen there and the header
 * clears the status bar itself. The Duo side band is applied here, at the
 * modal's outermost container: a modal is not inside any screen's padding.
 */
export function PreviewModalShell({
  visible,
  title,
  onClose,
  contentContainerStyle,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  contentContainerStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const screenInsets = useScreenHorizontalInsets();
  const androidTop = Math.max(insets.top, StatusBar.currentHeight ?? 0);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <ThemedView
        style={[styles.container, { backgroundColor: colors.background }, screenInsets]}
      >
        <View
          style={[
            styles.header,
            { borderBottomColor: colors.border },
            Platform.OS === "android" && {
              paddingTop: androidTop + 24,
              paddingBottom: 12,
              minHeight: 64,
            },
          ]}
        >
          <ThemedText
            style={[styles.title, { color: colors.text }]}
            accessibilityRole="header"
          >
            {title}
          </ThemedText>
          <Pressable
            style={({ pressed }) => [
              styles.doneButton,
              Platform.OS === "android" && { top: androidTop + 13 },
              pressed && { opacity: 0.7 },
            ]}
            onPress={onClose}
            accessibilityRole="button"
            hitSlop={8}
          >
            <ThemedText style={[styles.doneText, { color: colors.link }]}>
              Done
            </ThemedText>
          </Pressable>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={contentContainerStyle}
        >
          {children}
        </ScrollView>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    position: "relative",
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
  },
  doneButton: {
    position: "absolute",
    right: 16,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  doneText: {
    fontSize: 17,
    fontWeight: "600",
  },
  scrollView: {
    flex: 1,
  },
});
