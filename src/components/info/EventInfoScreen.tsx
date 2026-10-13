import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { useAppColors } from "@/hooks/useAppColors";
import { formatVenueLocation, venueAddressLines } from "@/lib/venue-address";
import * as WebBrowser from "expo-web-browser";
import React, { useState } from "react";
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { Palette } from "@/constants/Palette";

export default function EventInfoScreen() {
  const colors = useAppColors();
  const { meetDetails, isLoading } = useSelectedMeet();
  const [showVenueMapModal, setShowVenueMapModal] = useState(false);

  const venueMapPdfUrl = meetDetails?.venueMapPdfUrl ?? null;
  const venueMapAppleUrl = meetDetails?.venueMapAppleUrl ?? null;
  const hasVenueMap = Boolean(venueMapPdfUrl || venueMapAppleUrl);

  const openVenueMapPdf = async () => {
    if (!venueMapPdfUrl) return;
    try {
      await WebBrowser.openBrowserAsync(venueMapPdfUrl);
    } catch (error) {
      console.error("Failed to open venue map PDF:", error);
    }
  };

  const openVenueMapApple = async () => {
    if (!venueMapAppleUrl) return;
    try {
      await Linking.openURL(venueMapAppleUrl);
    } catch (error) {
      console.error("Failed to open venue map in Apple Maps:", error);
    }
  };

  const handleVenueMapPress = () => {
    if (venueMapPdfUrl && venueMapAppleUrl) {
      setShowVenueMapModal(true);
    } else if (venueMapPdfUrl) {
      void openVenueMapPdf();
    } else if (venueMapAppleUrl) {
      void openVenueMapApple();
    }
  };

  const venueMapLabel = venueMapPdfUrl && !venueMapAppleUrl ? "Venue Map (PDF)" : "Venue Map";

  // Blank and "Unknown" placeholder parts left out (`lib/venue-address`, the
  // same formatter as the calendar event location).
  const venueLines = venueAddressLines(meetDetails?.venue);
  const venueLocation = formatVenueLocation(meetDetails?.venue, meetDetails?.name);
  const addressLines = [venueLines.name, venueLines.street, venueLines.locality].filter(
    (line): line is string => Boolean(line),
  );
  // Without a findable location, what is left is shown as text, minus the
  // stand-in venue name that only repeats the meet's title.
  const plainVenueLines = venueLocation
    ? []
    : addressLines.filter((line) => line !== meetDetails?.name?.trim());

  const handleAddressPress = async () => {
    if (!venueLocation) return;

    const encodedAddress = encodeURIComponent(venueLocation);
    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;

    const mapsUrl = Platform.select({
      ios: `http://maps.apple.com/?address=${encodedAddress}`,
      android: googleMapsUrl,
      default: googleMapsUrl,
    });

    try {
      const supported = await Linking.canOpenURL(mapsUrl);
      if (supported) {
        await Linking.openURL(mapsUrl);
      } else {
        await Linking.openURL(googleMapsUrl);
      }
    } catch (error) {
      console.error("Failed to open maps:", error);
    }
  };

  if (isLoading || !meetDetails) {
    return (
      <ThemedView
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.section}>
            <ThemedText
              style={[styles.sectionText, { color: colors.secondaryText }]}
            >
              {isLoading ? "Loading..." : "No meet selected"}
            </ThemedText>
          </View>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <View style={styles.section}>
          <ThemedText style={[styles.mainTitle, { color: colors.text }]}>
            {meetDetails.name}
          </ThemedText>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        {venueLocation ? (
          <Pressable
            testID="info-venue-address"
            accessibilityRole="link"
            style={({ pressed }) => [
              styles.section,
              styles.lastSection,
              pressed && { backgroundColor: colors.pressed },
            ]}
            onPress={handleAddressPress}
          >
            <View>
              <View style={styles.addressContainer}>
                <View>
                  {addressLines.map((line, index) => (
                    <ThemedText key={`${index}-${line}`} style={[styles.link, { color: colors.link }]}>
                      {line}
                    </ThemedText>
                  ))}
                </View>
                <IconSymbol name="chevron.right" size={20} color={colors.link} />
              </View>
            </View>
          </Pressable>
        ) : plainVenueLines.length > 0 ? (
          // Only the backend's stand-in venue (the meet's own name): nothing
          // Maps can find, so plain text with no chevron.
          <View testID="info-venue-name" style={[styles.section, styles.lastSection]}>
            {plainVenueLines.map((line, index) => (
              <ThemedText key={`${index}-${line}`} style={{ color: colors.secondaryText }}>
                {line}
              </ThemedText>
            ))}
          </View>
        ) : null}

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        {hasVenueMap && (
          <Pressable
            testID="info-venue-map"
            accessibilityRole="button"
            accessibilityLabel={venueMapLabel}
            style={({ pressed }) => [
              styles.section,
              styles.lastSection,
              pressed && { backgroundColor: colors.pressed },
            ]}
            onPress={handleVenueMapPress}
          >
            <View style={styles.addressContainer}>
              <ThemedText style={[styles.link, { color: colors.link }]}>
                {venueMapLabel}
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>
        )}
      </View>

      <Modal
        visible={showVenueMapModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowVenueMapModal(false)}
      >
        <Pressable
          style={[styles.modalOverlay, { backgroundColor: colors.modalBackground }]}
          onPress={() => setShowVenueMapModal(false)}
        >
          <Pressable
            style={[styles.modalContent, { backgroundColor: colors.card }]}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <ThemedText style={[styles.modalTitle, { color: colors.text }]}>
                Venue Map
              </ThemedText>
            </View>

            <Pressable
              testID="venue-map-pdf-option"
              accessibilityRole="button"
              accessibilityLabel="PDF"
              style={({ pressed }) => [
                styles.modalOption,
                { borderBottomColor: colors.border },
                pressed && { backgroundColor: colors.pressed },
              ]}
              onPress={() => {
                setShowVenueMapModal(false);
                void openVenueMapPdf();
              }}
            >
              <ThemedText style={[styles.modalOptionText, { color: colors.link }]}>
                PDF
              </ThemedText>
            </Pressable>

            <Pressable
              testID="venue-map-apple-option"
              accessibilityRole="button"
              accessibilityLabel="Apple Maps"
              style={({ pressed }) => [
                styles.modalOption,
                { borderBottomColor: colors.border },
                pressed && { backgroundColor: colors.pressed },
              ]}
              onPress={() => {
                setShowVenueMapModal(false);
                void openVenueMapApple();
              }}
            >
              <ThemedText style={[styles.modalOptionText, { color: colors.link }]}>
                Apple Maps
              </ThemedText>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              style={({ pressed }) => [
                styles.modalOption,
                styles.modalCancel,
                pressed && { backgroundColor: colors.pressed },
              ]}
              onPress={() => setShowVenueMapModal(false)}
            >
              <ThemedText
                style={[styles.modalOptionText, { color: colors.secondaryText }]}
              >
                Cancel
              </ThemedText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  card: {
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: Palette.shadow,
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    marginBottom: 16,
  },
  section: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  lastSection: {
    borderBottomWidth: 0,
  },
  mainTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginTop: 4,
  },
  sectionText: {
    fontSize: 16,
    lineHeight: 24,
  },
  link: {
    fontSize: 16,
    lineHeight: 22,
  },
  addressContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  modalContent: {
    borderRadius: 16,
    overflow: "hidden",
  },
  modalHeader: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  modalOption: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  modalOptionText: {
    fontSize: 16,
    fontWeight: "500",
  },
  modalCancel: {
    borderBottomWidth: 0,
  },
});
