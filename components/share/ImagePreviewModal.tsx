import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { useAppColors } from "@/hooks/useAppColors";
import { ImagePreviewModalProps } from "@/types/start-list";
import * as Sharing from "expo-sharing";
import React from "react";
import {
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function ImagePreviewModal({
  visible,
  whiteImageUri,
  transparentImageUri,
  selectedIndex,
  onChangeIndex,
  onClose,
}: ImagePreviewModalProps) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const hasTransparent = Boolean(transparentImageUri);
  const activeIndex = hasTransparent ? selectedIndex : 0;

  const handleShare = async () => {
    const activeUri = activeIndex === 0 ? whiteImageUri : transparentImageUri;
    if (!activeUri) return;

    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        alert("Sharing is not available on this device");
        return;
      }

      await Sharing.shareAsync(activeUri, {
        mimeType: "image/png",
        dialogTitle: "Share Schedule",
      });
    } catch (error) {
      console.error("Error sharing image:", error);
      alert("Failed to share image");
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <ThemedView
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        {/* Header */}
        <View
          style={[
            styles.header,
            Platform.OS === "android" && {
              paddingTop:
                Math.max(insets.top, StatusBar.currentHeight ?? 0) + 24,
              paddingBottom: 12,
              minHeight: 64,
            },
          ]}
        >
          <ThemedText style={[styles.title, { color: colors.text }]}>
            Schedule Preview
          </ThemedText>
          <Pressable
            style={({ pressed }) => [
              styles.closeButton,
              Platform.OS === "android" && {
                top: Math.max(insets.top, StatusBar.currentHeight ?? 0) + 8,
              },
              pressed && { opacity: 0.7 },
            ]}
            onPress={onClose}
          >
            <ThemedText
              style={[styles.closeButtonText, { color: colors.link }]}
            >
              Done
            </ThemedText>
          </Pressable>
        </View>

        {/* Image Preview */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={true}
        >
          {whiteImageUri || transparentImageUri ? (
            <View style={styles.imageContainer}>
              {whiteImageUri && transparentImageUri && (
                <View style={styles.segmentedControl}>
                  <Pressable
                    style={[
                      styles.segment,
                      activeIndex === 0 && styles.segmentActive,
                    ]}
                    onPress={() => onChangeIndex(0)}
                  >
                    <ThemedText
                      style={[
                        styles.segmentText,
                        activeIndex === 0 && styles.segmentTextActive,
                      ]}
                    >
                      White
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.segment,
                      activeIndex === 1 && styles.segmentActive,
                    ]}
                    onPress={() => onChangeIndex(1)}
                  >
                    <ThemedText
                      style={[
                        styles.segmentText,
                        activeIndex === 1 && styles.segmentTextActive,
                      ]}
                    >
                      Transparent
                    </ThemedText>
                  </Pressable>
                </View>
              )}

              {/* Image Preview */}
              <View
                style={[
                  styles.imageCard,
                  activeIndex === 1 && styles.imageCardTransparent,
                ]}
              >
                {activeIndex === 1 ? (
                  <View style={styles.checkerboard} pointerEvents="none">
                    {Array.from({ length: 8 }).map((_, rowIndex) => (
                      <View style={styles.checkerRow} key={`row-${rowIndex}`}>
                        {Array.from({ length: 8 }).map((__, colIndex) => {
                          const isLight = (rowIndex + colIndex) % 2 === 0;
                          return (
                            <View
                              key={`cell-${rowIndex}-${colIndex}`}
                              style={[
                                styles.checkerSquare,
                                isLight
                                  ? styles.checkerLight
                                  : styles.checkerDark,
                              ]}
                            />
                          );
                        })}
                      </View>
                    ))}
                  </View>
                ) : null}
                <Image
                  source={{
                    uri:
                      activeIndex === 0
                        ? whiteImageUri || ""
                        : transparentImageUri || "",
                  }}
                  style={styles.image}
                  resizeMode="contain"
                />
              </View>

              {/* Share Button */}
              <Pressable
                style={({ pressed }) => [
                  styles.shareButton,
                  pressed && { opacity: 0.8 },
                ]}
                onPress={handleShare}
              >
                <IconSymbol
                  name={
                    Platform.select({
                      ios: "square.and.arrow.up",
                      android: "share",
                    }) || "square.and.arrow.up"
                  }
                  size={20}
                  color="#FFFFFF"
                />
                <ThemedText style={styles.shareButtonText}>
                  Share {activeIndex === 0 ? "White" : "Transparent"} Background
                </ThemedText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.noImageContainer}>
              <ThemedText
                style={[styles.noImageText, { color: colors.secondaryText }]}
              >
                No image available
              </ThemedText>
            </View>
          )}
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
    borderBottomColor: "#E1E1E1",
    position: "relative",
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
  },
  closeButton: {
    position: "absolute",
    right: 16,
    padding: 4,
  },
  closeButtonText: {
    fontSize: 17,
    fontWeight: "600",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  imageContainer: {
    alignItems: "center",
    gap: 20,
    width: "100%",
  },
  imageCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 20,
    width: "100%",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  imageCardTransparent: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#DADADA",
  },
  image: {
    width: "100%",
    aspectRatio: 850 / 1200,
    borderRadius: 0,
  },
  segmentedControl: {
    flexDirection: "row",
    backgroundColor: "#E9E9EB",
    borderRadius: 10,
    padding: 2,
    width: "100%",
    maxWidth: 320,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  segmentActive: {
    backgroundColor: "#FFFFFF",
  },
  segmentText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6B6B6B",
  },
  segmentTextActive: {
    color: "#000000",
  },
  checkerboard: {
    ...StyleSheet.absoluteFillObject,
  },
  checkerRow: {
    flex: 1,
    flexDirection: "row",
  },
  checkerSquare: {
    flex: 1,
  },
  checkerLight: {
    backgroundColor: "#F0F0F0",
  },
  checkerDark: {
    backgroundColor: "#D8D8D8",
  },
  shareButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#007AFF",
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    width: "100%",
    maxWidth: 400,
  },
  shareButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
  noImageContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },
  noImageText: {
    fontSize: 17,
  },
});
