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
  const imageOptions = React.useMemo(
    () =>
      [
        whiteImageUri
          ? {
              id: "readable",
              label: "Readable",
              uri: whiteImageUri,
              category: "readability" as const,
              isTransparent: false,
            }
          : null,
        transparentImageUri
          ? {
              id: "transparent",
              label: "Transparent",
              uri: transparentImageUri,
              category: "social" as const,
              isTransparent: true,
            }
          : null,
      ].filter((option): option is NonNullable<typeof option> => Boolean(option)),
    [whiteImageUri, transparentImageUri],
  );
  const safeIndex = Math.min(selectedIndex, Math.max(imageOptions.length - 1, 0));
  const selectedOption = imageOptions[safeIndex] || null;

  const readableOptions = imageOptions.filter(
    (option) => option.category === "readability",
  );
  const socialOptions = imageOptions.filter(
    (option) => option.category === "social",
  );

  const handleShare = async () => {
    if (!selectedOption?.uri) return;

    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        alert("Sharing is not available on this device");
        return;
      }

      await Sharing.shareAsync(selectedOption.uri, {
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

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={true}
        >
          {selectedOption ? (
            <View style={styles.imageContainer}>
              <View style={styles.optionSections}>
                <OptionRow
                  title="Readable"
                  options={readableOptions}
                  activeId={selectedOption?.id ?? ""}
                  onPress={(id) => {
                    const nextIndex = imageOptions.findIndex((o) => o.id === id);
                    if (nextIndex >= 0) onChangeIndex(nextIndex);
                  }}
                />
                <OptionRow
                  title="Social"
                  options={socialOptions}
                  activeId={selectedOption?.id ?? ""}
                  onPress={(id) => {
                    const nextIndex = imageOptions.findIndex((o) => o.id === id);
                    if (nextIndex >= 0) onChangeIndex(nextIndex);
                  }}
                />
              </View>

              <View
                style={[
                  styles.imageCard,
                  selectedOption.isTransparent && styles.imageCardTransparent,
                ]}
              >
                {selectedOption.isTransparent ? (
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
                  source={{ uri: selectedOption.uri }}
                  style={styles.image}
                  resizeMode="contain"
                />
              </View>

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
                  Share {selectedOption.label}
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

type OptionRowProps = {
  title: string;
  options: ImagePreviewModalProps["imageOptions"];
  activeId: string;
  onPress: (id: string) => void;
};

function OptionRow({ title, options, activeId, onPress }: OptionRowProps) {
  if (options.length === 0) return null;

  return (
    <View style={styles.optionRowWrap}>
      <ThemedText style={styles.optionRowTitle}>{title}</ThemedText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.segmentedControl}
      >
        {options.map((option) => {
          const isActive = option.id === activeId;
          return (
            <Pressable
              key={option.id}
              style={[styles.segment, isActive && styles.segmentActive]}
              onPress={() => onPress(option.id)}
            >
              <ThemedText
                style={[
                  styles.segmentText,
                  isActive && styles.segmentTextActive,
                ]}
              >
                {option.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
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
  optionSections: {
    width: "100%",
    gap: 12,
  },
  optionRowWrap: {
    gap: 6,
  },
  optionRowTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#8E8E93",
    textTransform: "uppercase",
    letterSpacing: 0.6,
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
    gap: 8,
    paddingRight: 8,
  },
  segment: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: "center",
    backgroundColor: "#ECEFF3",
  },
  segmentActive: {
    backgroundColor: "#111827",
  },
  segmentText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#4B5563",
  },
  segmentTextActive: {
    color: "#FFFFFF",
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
