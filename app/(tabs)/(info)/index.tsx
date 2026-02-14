import EventInfoScreen from "@/components/info/EventInfoScreen";
import ListButton from "@/components/info/ListButton";
import SectionTitle from "@/components/info/SectionTitle";
import {
  OnboardingView,
  resetOnboarding,
} from "@/components/schedule/OnboardingView";
import {
  resetVersionAnnouncement,
  VersionAnnouncement,
} from "@/components/schedule/VersionAnnouncement";
import { ThemedView } from "@/components/ui/ThemedView";
import { useAppColors } from "@/hooks/useAppColors";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function InfoScreen() {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [versionAnnouncementKey, setVersionAnnouncementKey] = useState(0);

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Stack.Screen
        options={{
          headerTitle: "Info",
          headerTitleStyle: {
            color: colors.text,
          },
          headerStyle: {
            backgroundColor: colors.background,
          },
          headerShadowVisible: false,
        }}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 20,
          paddingBottom: Math.max(80, insets.bottom + 60),
        }}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        <EventInfoScreen />

        <SectionTitle title="National" />
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <ListButton
            title="Adaptive American Records"
            onPress={() => router.push("/comp-data/adap-records")}
          />

          <ListButton
            title="All Meet Results"
            onPress={() => router.push("/comp-data/all-meet-results")}
          />

          <ListButton
            title="Club Meet Results"
            onPress={() => router.push("/comp-data/club-results/clubs-list")}
          />

          <ListButton
            title="National Rankings"
            onPress={() => router.push("/comp-data/national-rankings")}
          />

          <ListButton
            title="National & World Records"
            onPress={() => router.push("/comp-data/records")}
          />

          <ListButton
            title="WSO Records"
            onPress={() => router.push("/comp-data/wso-records")}
          />

          <ListButton
            title="Qualifying Totals"
            lastSection={true}
            onPress={() => router.push("/comp-data/new-qualifying-totals")}
          />
        </View>

        <SectionTitle title="International" />
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <ListButton
            title="A/B Standards"
            onPress={() => router.push("/comp-data/new-standards")}
          />

          <ListButton
            title="International Rankings"
            lastSection={true}
            onPress={() => router.push("/comp-data/rankings")}
          />
        </View>

        {__DEV__ && (
          <>
            <SectionTitle title="Development Tools" />

            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <ListButton
                title="Show Onboarding"
                onPress={async () => {
                  await resetOnboarding();
                  setShowOnboarding(true);
                }}
              />
              <ListButton
                title="Show Version Announcement"
                lastSection={true}
                onPress={async () => {
                  await resetVersionAnnouncement();
                  setVersionAnnouncementKey((prev) => prev + 1);
                }}
              />
            </View>
          </>
        )}
      </ScrollView>

      {__DEV__ && (
        <>
          <OnboardingView
            visible={showOnboarding}
            onComplete={() => setShowOnboarding(false)}
          />
          <VersionAnnouncement key={versionAnnouncementKey} />
        </>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  card: {
    borderRadius: 12,
    marginBottom: 16,
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
});
