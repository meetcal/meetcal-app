import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { useAppColors } from "@/hooks/useAppColors";
import { Stack } from "expo-router";
import { useMemo } from "react";
import { Linking, Platform, Pressable, StyleSheet, View } from "react-native";

export default function EventInfoScreen() {
  const colors = useAppColors();
  const { selectedMeet, meetDetails, isLoading } = useSelectedMeet();

  // Get full time zone name
  const timeZoneName = useMemo(() => {
    if (!meetDetails?.time.timeZoneIdentifier) return "Local Time";
    const date = new Date();
    return (
      new Intl.DateTimeFormat("en-US", {
        timeZone: meetDetails.time.timeZoneIdentifier,
        timeZoneName: "long",
      })
        .formatToParts(date)
        .find((part) => part.type === "timeZoneName")?.value || "Local Time"
    );
  }, [meetDetails?.time.timeZoneIdentifier]);

  const handleAddressPress = () => {
    if (!meetDetails?.venue) return;

    const address = `${meetDetails.venue.name}, ${meetDetails.venue.address.street}, ${meetDetails.venue.address.city}, ${meetDetails.venue.address.state} ${meetDetails.venue.address.zip}`;
    const encodedAddress = encodeURIComponent(address);

    const mapsUrl = Platform.select({
      ios: `maps://maps.apple.com/?address=${encodedAddress}`,
      android: `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`,
      default: `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`,
    });

    Linking.canOpenURL(mapsUrl).then((supported) => {
      if (supported) {
        Linking.openURL(mapsUrl);
      } else {
        Linking.openURL(
          `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`,
        );
      }
    });
  };

  if (isLoading || !meetDetails) {
    return (
      <ThemedView
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <Stack.Screen
          options={{
            title: "Event Info",
            headerBackTitle: "Back",
            headerShown: true,
            gestureEnabled: true,
            gestureDirection: "horizontal",
            animation: "slide_from_right",
            headerStyle: {
              backgroundColor: colors.background,
            },
            headerShadowVisible: false,
          }}
        />
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
      {/* <Stack.Screen options={{ 
        title: "Event Info",
        headerBackTitle: "Back",
        headerShown: true,
        gestureEnabled: true,
        gestureDirection: 'horizontal',
        animation: 'slide_from_right',
        headerStyle: {
          backgroundColor: colors.background,
        },
        headerShadowVisible: false,
      }} /> */}

      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <View style={styles.section}>
          <ThemedText style={[styles.mainTitle, { color: colors.text }]}>
            {meetDetails.name}
          </ThemedText>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <Pressable
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
                <ThemedText style={[styles.link, { color: colors.link }]}>
                  {meetDetails.venue.name}
                </ThemedText>
                <ThemedText style={[styles.link, { color: colors.link }]}>
                  {meetDetails.venue.address.street}
                </ThemedText>
                <ThemedText style={[styles.link, { color: colors.link }]}>
                  {meetDetails.venue.address.city},{" "}
                  {meetDetails.venue.address.state}{" "}
                  {meetDetails.venue.address.zip}
                </ThemedText>
              </View>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </View>
        </Pressable>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />
      </View>
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
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
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
  sectionTitle: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 4,
  },
  sectionText: {
    fontSize: 16,
    lineHeight: 24,
  },
  label: {
    fontSize: 16,
    marginBottom: 4,
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
});
