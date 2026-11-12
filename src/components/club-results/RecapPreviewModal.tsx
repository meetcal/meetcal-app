import React from "react";
import { Image, Platform, Pressable, StyleSheet } from "react-native";
import { PreviewModalShell } from "@/components/share/PreviewModalShell";
import { RECAP_IMAGE_HEIGHT, RECAP_IMAGE_WIDTH } from "@/components/club-results/ShareableRecapView";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { Palette } from "@/constants/Palette";
import { useAppColors } from "@/hooks/useAppColors";

export function RecapPreviewModal({
  visible,
  imageUri,
  onClose,
  onShare,
}: {
  visible: boolean;
  imageUri: string | null;
  onClose: () => void;
  onShare: () => void;
}) {
  const colors = useAppColors();

  return (
    <PreviewModalShell
      visible={visible}
      title="Recap Preview"
      onClose={onClose}
      contentContainerStyle={styles.modalContent}
    >
      {imageUri && (
        <>
          <Image
            source={{ uri: imageUri }}
            style={styles.previewImage}
            resizeMode="contain"
            accessibilityLabel="Meet recap image"
          />
          <Pressable
            style={[styles.shareButton, { backgroundColor: colors.link, shadowColor: colors.link }]}
            onPress={onShare}
            accessibilityRole="button"
          >
            <IconSymbol
              name={Platform.OS === "ios" ? "square.and.arrow.up" : "share"}
              size={20}
              color={Palette.white}
            />
            <ThemedText style={styles.shareButtonText}>Share Recap</ThemedText>
          </Pressable>
        </>
      )}
    </PreviewModalShell>
  );
}

const styles = StyleSheet.create({
  modalContent: {
    padding: 20,
    alignItems: "center",
    gap: 20,
  },
  previewImage: {
    width: "100%",
    aspectRatio: RECAP_IMAGE_WIDTH / RECAP_IMAGE_HEIGHT,
    borderRadius: 12,
  },
  shareButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 14,
    width: "100%",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  shareButtonText: {
    color: Palette.white,
    fontSize: 17,
    fontWeight: "600",
  },
});
