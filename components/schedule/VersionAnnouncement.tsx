import { IconSymbol } from "@/components/ui/IconSymbol";
import { CURRENT_VERSION, getAnnouncementForVersion, VERSION_ANNOUNCEMENT_KEY } from "@/config/version-announcements";
import { useAppColors } from "@/hooks/useAppColors";
import { VersionAnnouncementProps } from "@/types/schedule";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function VersionAnnouncement({
  announcement: propAnnouncement,
}: VersionAnnouncementProps) {
  const [isVisible, setIsVisible] = useState(false);
  const insets = useSafeAreaInsets();
  const colors = useAppColors();

  const announcement =
    propAnnouncement || getAnnouncementForVersion(CURRENT_VERSION);

  useEffect(() => {
    if (announcement) {
      checkIfShouldShow();
    }
  }, [announcement]);

  const checkIfShouldShow = async () => {
    try {
      const seenVersions = await AsyncStorage.getItem(VERSION_ANNOUNCEMENT_KEY);
      const seenVersionsArray = seenVersions ? JSON.parse(seenVersions) : [];

      if (!seenVersionsArray.includes(CURRENT_VERSION)) {
        setIsVisible(true);
      }
    } catch (error) {
      console.error("Error checking version announcement:", error);
    }
  };

  const handleDismiss = async () => {
    try {
      const seenVersions = await AsyncStorage.getItem(VERSION_ANNOUNCEMENT_KEY);
      const seenVersionsArray = seenVersions ? JSON.parse(seenVersions) : [];

      if (!seenVersionsArray.includes(CURRENT_VERSION)) {
        seenVersionsArray.push(CURRENT_VERSION);
        await AsyncStorage.setItem(
          VERSION_ANNOUNCEMENT_KEY,
          JSON.stringify(seenVersionsArray),
        );
      }

      setIsVisible(false);
    } catch (error) {
      console.error("Error dismissing version announcement:", error);
      setIsVisible(false);
    }
  };

  if (!announcement) {
    return null;
  }

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="slide"
      onRequestClose={handleDismiss}
    >
      <Pressable
        style={[
          styles.modalOverlay,
          { backgroundColor: colors.modalBackground },
        ]}
        onPress={handleDismiss}
      >
        <Pressable
          style={[
            styles.modalContent,
            {
              backgroundColor: colors.card,
              paddingBottom: Math.max(insets.bottom, 20),
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.header}>
            <View style={styles.headerContent}>
              <Text style={[styles.title, { color: colors.text }]}>
                {announcement.title}
              </Text>
              <Text style={[styles.version, { color: colors.secondaryText }]}>
                Version {CURRENT_VERSION}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={handleDismiss}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <IconSymbol
                name={Platform.OS === "ios" ? "xmark" : "close"}
                size={20}
                color={colors.secondaryText}
              />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.message, { color: colors.text }]}>
              {announcement.message}
            </Text>

            {announcement.features && announcement.features.length > 0 && (
              <View style={styles.featuresContainer}>
                {announcement.features.map((feature) => (
                  <View key={feature} style={styles.featureItem}>
                    <IconSymbol
                      name="checkmark.circle.fill"
                      size={18}
                      color={colors.link}
                    />
                    <Text style={[styles.featureText, { color: colors.text }]}>
                      {feature}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>

          <TouchableOpacity
            style={[styles.dismissButton, { backgroundColor: colors.link }]}
            onPress={handleDismiss}
          >
            <Text style={styles.dismissButtonText}>Got it</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: "80%",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: -2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 10,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  headerContent: {
    flex: 1,
    marginRight: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 4,
  },
  version: {
    fontSize: 14,
    fontWeight: "500",
    opacity: 0.7,
  },
  closeButton: {
    padding: 4,
  },
  scrollContent: {
    flexGrow: 0,
  },
  message: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 20,
  },
  featuresContainer: {
    marginTop: 8,
    marginBottom: 8,
  },
  featureItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
    gap: 12,
  },
  featureText: {
    fontSize: 15,
    lineHeight: 22,
    flex: 1,
  },
  dismissButton: {
    marginTop: 20,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  dismissButtonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "600",
  },
});

export async function resetVersionAnnouncement(): Promise<void> {
  try {
    await AsyncStorage.removeItem(VERSION_ANNOUNCEMENT_KEY);
  } catch (error) {
    console.error("Error resetting version announcement:", error);
  }
}
