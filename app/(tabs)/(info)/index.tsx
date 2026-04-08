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
import { useAuthGuard } from "@/utils/authGuard";
import * as Sentry from '@sentry/react-native';
import { Stack, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function InfoScreen() {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { requireAuth } = useAuthGuard();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [versionAnnouncementKey, setVersionAnnouncementKey] = useState(0);

  const openCompDataScreen = useCallback(
    (pathname: string, feature: string) => {
      const authResult = requireAuth({
        feature,
        message: "Sign in to access premium features.",
        returnPath: "/(tabs)/(info)",
      });
      if (authResult === null || authResult === false) {
        return;
      }
      router.push(pathname as any);
    },
    [requireAuth, router],
  );

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
            onPress={() => openCompDataScreen("/comp-data/adap-records", "adaptive-records")}
          />

          <ListButton
            title="All Meet Results"
            onPress={() => openCompDataScreen("/comp-data/all-meet-results", "all-meet-results")}
          />

          <ListButton
            title="Club Meet Results"
            onPress={() =>
              openCompDataScreen("/comp-data/club-results/clubs-list", "club-meet-results")
            }
          />

          <ListButton
            title="National Rankings"
            onPress={() =>
              openCompDataScreen("/comp-data/national-rankings", "national-rankings")
            }
          />

          <ListButton
            title="National & World Records"
            onPress={() => openCompDataScreen("/comp-data/records", "records")}
          />

          <ListButton
            title="Weightlifting Wrapped"
            onPress={() => router.push("/comp-data/weightlifting-wrapped")}
          />

          <ListButton
            title="WSO Records"
            onPress={() => openCompDataScreen("/comp-data/wso-records", "wso-records")}
          />

          <ListButton
            title="Qualifying Totals"
            lastSection={true}
            onPress={() =>
              openCompDataScreen("/comp-data/new-qualifying-totals", "qualifying-totals")
            }
          />
        </View>

        <SectionTitle title="International" />
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <ListButton
            title="A/B Standards"
            onPress={() => openCompDataScreen("/comp-data/new-standards", "standards")}
          />

          <ListButton
            title="International Rankings"
            lastSection={true}
            onPress={() => openCompDataScreen("/comp-data/rankings", "international-rankings")}
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
                onPress={async () => {
                  await resetVersionAnnouncement();
                  setVersionAnnouncementKey((prev) => prev + 1);
                }}
              />
              <ListButton title='Sentry Test' lastSection={true} onPress={ () => { Sentry.captureException(new Error('First error')) }}/>
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
