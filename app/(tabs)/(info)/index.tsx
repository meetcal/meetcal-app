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
import { showToast } from "@/components/ui/Toast";
import {
  disableMockMeetData,
  enableMockMeetData,
} from "@/config/dev-mock-meet";
import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
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
  const { selectedMeet, setSelectedMeet } = useSelectedMeet();
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
      testID="info-screen"
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
            testID="info-adaptive-records"
            onPress={() => openCompDataScreen("/comp-data/adap-records", "adaptive-records")}
          />

          <ListButton
            title="All Meet Results"
            testID="info-all-meet-results"
            onPress={() => openCompDataScreen("/comp-data/all-meet-results", "all-meet-results")}
          />

          <ListButton
            title="Club Meet Results"
            testID="info-club-meet-results"
            onPress={() =>
              openCompDataScreen("/comp-data/club-results/clubs-list", "club-meet-results")
            }
          />

          <ListButton
            title="National Rankings"
            testID="info-national-rankings"
            onPress={() =>
              openCompDataScreen("/comp-data/national-rankings", "national-rankings")
            }
          />

          <ListButton
            title="National & World Records"
            testID="info-records"
            onPress={() => openCompDataScreen("/comp-data/records", "records")}
          />

          <ListButton
            title="Weightlifting Wrapped"
            testID="info-weightlifting-wrapped"
            onPress={() => router.push("/comp-data/weightlifting-wrapped")}
          />

          <ListButton
            title="WSO Records"
            testID="info-wso-records"
            onPress={() => openCompDataScreen("/comp-data/wso-records", "wso-records")}
          />

          <ListButton
            title="Qualifying Totals"
            testID="info-qualifying-totals"
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
            testID="info-standards"
            onPress={() => openCompDataScreen("/comp-data/new-standards", "standards")}
          />

          <ListButton
            title="International Rankings"
            testID="info-international-rankings"
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
              <ListButton
                title="Select 2026 Nationals"
                onPress={async () => {
                  try {
                    await setSelectedMeet(
                      "2026 USA Weightlifting National Championships, Powered by Rogue Fitness",
                    );
                    showToast({
                      type: "success",
                      message: "Selected meet set to 2026 Nationals",
                    });
                  } catch {
                    showToast({
                      type: "error",
                      message: "Failed to set selected meet",
                    });
                  }
                }}
              />
              <ListButton
                title="Fill Selected Meet with Test Data"
                onPress={async () => {
                  if (!selectedMeet) {
                    showToast({ type: "error", message: "No meet selected" });
                    return;
                  }
                  await enableMockMeetData(selectedMeet);
                  showToast({
                    type: "success",
                    message: "Test sessions and athletes enabled — reopen the schedule tab",
                  });
                }}
              />
              <ListButton
                title="Clear Test Data"
                onPress={async () => {
                  await disableMockMeetData();
                  showToast({
                    type: "success",
                    message: "Test data disabled — real data loads on next refresh",
                  });
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
