import React from 'react';
import { View, StyleSheet, Modal, Pressable, ScrollView, Image, Platform } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { useTheme } from '@/contexts/ThemeContext';
import * as Sharing from 'expo-sharing';

interface ImagePreviewModalProps {
  visible: boolean;
  imageUri: string | null;
  onClose: () => void;
}

export default function ImagePreviewModal({
  visible,
  imageUri,
  onClose,
}: ImagePreviewModalProps) {
  const { currentTheme } = useTheme();

  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
  };

  const handleShare = async () => {
    if (!imageUri) return;

    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        alert('Sharing is not available on this device');
        return;
      }

      await Sharing.shareAsync(imageUri, {
        mimeType: 'image/png',
        dialogTitle: 'Share Schedule',
      });
    } catch (error) {
      console.error('Error sharing image:', error);
      alert('Failed to share image');
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={styles.header}>
          <ThemedText style={[styles.title, { color: colors.text }]}>
            Schedule Preview
          </ThemedText>
          <Pressable
            style={({ pressed }) => [
              styles.closeButton,
              pressed && { opacity: 0.7 },
            ]}
            onPress={onClose}
          >
            <ThemedText style={[styles.closeButtonText, { color: '#007AFF' }]}>
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
          {imageUri ? (
            <View style={styles.imageContainer}>
              {/* White card container for image */}
              <View style={styles.imageCard}>
                <Image
                  source={{ uri: imageUri }}
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
                  name={Platform.select({
                    ios: 'square.and.arrow.up',
                    android: 'share',
                  }) || 'square.and.arrow.up'}
                  size={20}
                  color="#FFFFFF"
                />
                <ThemedText style={styles.shareButtonText}>
                  Share Schedule
                </ThemedText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.noImageContainer}>
              <ThemedText style={[styles.noImageText, { color: colors.secondaryText }]}>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E1E1E1',
    position: 'relative',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  closeButton: {
    position: 'absolute',
    right: 16,
    padding: 4,
  },
  closeButtonText: {
    fontSize: 17,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  imageContainer: {
    alignItems: 'center',
    gap: 20,
    width: '100%',
  },
  imageCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  image: {
    width: '100%',
    aspectRatio: 850 / 1200,
    borderRadius: 0,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    width: '100%',
    maxWidth: 400,
  },
  shareButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  noImageContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  noImageText: {
    fontSize: 17,
  },
});
