import EventInfoScreen from "@/components/info/EventInfoScreen";
import { OnboardingView, resetOnboarding } from "@/components/OnboardingView";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { IconSymbol } from "@/components/ui/IconSymbol";
import {
  resetVersionAnnouncement,
  VersionAnnouncement,
} from "@/components/VersionAnnouncement";
import { useAppColors } from "@/hooks/useAppColors";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
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
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <EventInfoScreen />

          {/* <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/shared-screens/weightlifting-wrapped')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Weightlifting Wrapped
              </ThemedText>
              <IconSymbol
                name={Platform.OS === 'ios' ? 'chevron.right' : 'chevron-forward'}
                size={20}
                color={colors.link}
              />
            </View>
          </Pressable> */}
        </View>

        <ThemedText
          style={[styles.sectionHeader, { color: colors.secondaryText }]}
        >
          National
        </ThemedText>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Pressable
            style={({ pressed }) => [
              styles.section,
              {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: colors.border,
              },
              pressed && { backgroundColor: colors.pressed },
            ]}
            onPress={() => router.push("/comp-data/adap-records")}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Adaptive American Records
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.section,
              {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: colors.border,
              },
              pressed && { backgroundColor: colors.pressed },
            ]}
            onPress={() => router.push("/comp-data/all-meet-results")}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                All Meet Results
              </ThemedText>
              <IconSymbol
                name={
                  Platform.OS === "ios" ? "chevron.right" : "chevron-forward"
                }
                size={20}
                color={colors.link}
              />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.section,
              {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: colors.border,
              },
              pressed && { backgroundColor: colors.pressed },
            ]}
            onPress={() => router.push("/comp-data/club-results/clubs-list")}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Club Meet Results
              </ThemedText>
              <IconSymbol
                name={
                  Platform.OS === "ios" ? "chevron.right" : "chevron-forward"
                }
                size={20}
                color={colors.link}
              />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.section,
              {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: colors.border,
              },
              pressed && { backgroundColor: colors.pressed },
            ]}
            onPress={() => router.push("/comp-data/national-rankings")}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                National Rankings
              </ThemedText>
              <IconSymbol
                name={
                  Platform.OS === "ios" ? "chevron.right" : "chevron-forward"
                }
                size={20}
                color={colors.link}
              />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.section,
              {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: colors.border,
              },
              pressed && { backgroundColor: colors.pressed },
            ]}
            onPress={() => router.push("/comp-data/records")}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                National & World Records
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.section,
              {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: colors.border,
              },
              pressed && { backgroundColor: colors.pressed },
            ]}
            onPress={() => router.push("/comp-data/wso-records")}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                WSO Records
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.section,
              styles.lastSection,
              pressed && { backgroundColor: colors.pressed },
            ]}
            onPress={() => router.push("/comp-data/new-qualifying-totals")}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Qualifying Totals
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>
        </View>

        <ThemedText
          style={[styles.sectionHeader, { color: colors.secondaryText }]}
        >
          International
        </ThemedText>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Pressable
            style={({ pressed }) => [
              styles.section,
              {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: colors.border,
              },
              pressed && { backgroundColor: colors.pressed },
            ]}
            onPress={() => router.push("/comp-data/new-standards")}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                A/B Standards
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.section,
              styles.lastSection,
              pressed && { backgroundColor: colors.pressed },
            ]}
            onPress={() => router.push("/comp-data/rankings")}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                International Rankings
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>
        </View>

        {__DEV__ && (
          <>
            <ThemedText
              style={[styles.sectionHeader, { color: colors.secondaryText }]}
            >
              Development Tools
            </ThemedText>
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <Pressable
                style={({ pressed }) => [
                  styles.section,
                  {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                  },
                  pressed && { backgroundColor: colors.pressed },
                ]}
                onPress={async () => {
                  await resetOnboarding();
                  setShowOnboarding(true);
                }}
              >
                <View style={styles.linkRow}>
                  <ThemedText style={[styles.label, { color: colors.text }]}>
                    Show Onboarding
                  </ThemedText>
                  <IconSymbol
                    name="chevron.right"
                    size={20}
                    color={colors.link}
                  />
                </View>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.section,
                  styles.lastSection,
                  pressed && { backgroundColor: colors.pressed },
                ]}
                onPress={async () => {
                  await resetVersionAnnouncement();
                  setVersionAnnouncementKey((prev) => prev + 1);
                }}
              >
                <View style={styles.linkRow}>
                  <ThemedText style={[styles.label, { color: colors.text }]}>
                    Show Version Announcement
                  </ThemedText>
                  <IconSymbol
                    name="chevron.right"
                    size={20}
                    color={colors.link}
                  />
                </View>
              </Pressable>
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
  sectionHeader: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 8,
    marginTop: 8,
  },
  section: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lastSection: {
    borderBottomWidth: 0,
  },
  label: {
    fontSize: 16,
    marginBottom: 4,
  },
  linkRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
});
