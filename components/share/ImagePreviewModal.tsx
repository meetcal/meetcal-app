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
  const [imageAspectRatio, setImageAspectRatio] = React.useState(850 / 1200);
  const imageOptions = React.useMemo<ImageOption[]>(
    () =>
      [
        whiteImageUri
          ? {
              id: "white",
              label: "White",
              uri: whiteImageUri,
              isTransparent: false,
            }
          : null,
        transparentImageUri
          ? {
              id: "transparent",
              label: "Transparent",
              uri: transparentImageUri,
              isTransparent: true,
            }
          : null,
      ].filter((option): option is NonNullable<typeof option> => Boolean(option)),
    [whiteImageUri, transparentImageUri],
  );
  const safeIndex = Math.min(selectedIndex, Math.max(imageOptions.length - 1, 0));
  const selectedOption = imageOptions[safeIndex] || null;

  React.useEffect(() => {
    if (!selectedOption?.uri) return;
    Image.getSize(
      selectedOption.uri,
      (width, height) => {
        if (width > 0 && height > 0) {
          setImageAspectRatio(width / height);
        }
      },
      () => {
        setImageAspectRatio(850 / 1200);
      },
    );
  }, [selectedOption?.uri]);

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
                <View
                  style={[
                    styles.segmentedControl,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  {imageOptions.map((option, index) => {
                    const isActive = option.id === selectedOption.id;
                    return (
                      <Pressable
                        key={option.id}
                        style={({ pressed }) => [
                          styles.segment,
                          isActive && { backgroundColor: colors.link },
                          pressed && { opacity: 0.85 },
                        ]}
                        onPress={() => onChangeIndex(index)}
                      >
                        <ThemedText
                          style={[
                            styles.segmentText,
                            {
                              color: isActive ? "#FFFFFF" : colors.secondaryText,
                            },
                          ]}
                        >
                          {option.label}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
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
                  style={[styles.image, { aspectRatio: imageAspectRatio }]}
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
                  {`Share ${selectedOption.label}`}
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

type ImageOption = {
  id: string;
  label: string;
  uri: string;
  isTransparent: boolean;
};

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
    paddingBottom: 2,
  },
  imageCard: {
    backgroundColor: "transparent",
    borderRadius: 0,
    width: "100%",
  },
  imageCardTransparent: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#DADADA",
  },
  image: {
    width: "100%",
    borderRadius: 0,
  },
  segmentedControl: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentText: {
    fontSize: 15,
    fontWeight: "600",
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
