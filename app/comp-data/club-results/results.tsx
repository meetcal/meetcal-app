import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { useAppColors } from "@/hooks/useAppColors";
import { fetchClubMeetStats } from "@/lib/database/fetch-club-stats";
import {
  isNetworkAvailable,
  subscribeToNetworkChanges,
} from "@/lib/networkUtils";
import { posthog } from "@/lib/posthog";
import type { ClubMeetStats } from "@/types/club";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { captureRef } from "react-native-view-shot";

export default function MeetResultsByClubScreen() {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { club, meet } = useLocalSearchParams<{ club: string; meet: string }>();

  const [isLoading, setIsLoading] = useState(true);
  const [clubStats, setClubStats] = useState<ClubMeetStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [generatedImageUri, setGeneratedImageUri] = useState<string | null>(
    null,
  );
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  const shareableViewRef = useRef<View>(null);

  // Track screen view on mount
  useEffect(() => {
    posthog.capture("screen_viewed", {
      screen_name: "Meet Results By Club",
      club_name: club,
      meet_name: meet,
    });
  }, [club, meet]);

  useEffect(() => {
    let isMounted = true;
    const checkNetwork = async () => {
      const hasNetwork = await isNetworkAvailable();
      if (isMounted) setIsOffline(!hasNetwork);
    };
    checkNetwork();
    const unsubscribe = subscribeToNetworkChanges((isConnected) => {
      setIsOffline(!isConnected);
    });
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const loadStats = useCallback(async () => {
    if (!club || !meet) return;

    setIsLoading(true);
    setError(null);

    try {
      const hasNetwork = await isNetworkAvailable();
      if (!hasNetwork) {
        setIsOffline(true);
        setClubStats(null);
        setError("Offline - meet results are not available");
        return;
      }
      const stats = await fetchClubMeetStats(club, meet);
      setClubStats(stats);
    } catch (err) {
      console.error("Error loading stats:", err);
      setError("Failed to load meet statistics");
    } finally {
      setIsLoading(false);
    }
  }, [club, meet]);

  // Load stats on mount
  useEffect(() => {
    if (club && meet) {
      loadStats();
    }
  }, [club, meet, loadStats]);

  const generateImage = async () => {
    if (
      !shareableViewRef.current ||
      !clubStats ||
      clubStats.totalAthletes === 0
    ) {
      return;
    }

    setIsGeneratingImage(true);

    try {
      const uri = await captureRef(shareableViewRef.current, {
        format: "png",
        quality: 1,
        result: "tmpfile",
      });

      setGeneratedImageUri(uri);
      setShowPreview(true);

      posthog.capture("club_meet_recap_generated", {
        club_name: club,
        meet_name: meet,
      });
    } catch (err) {
      console.error("Error generating image:", err);
      alert("Failed to generate image");
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleShare = async () => {
    if (!generatedImageUri) return;

    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        alert("Sharing is not available on this device");
        return;
      }

      await Sharing.shareAsync(generatedImageUri, {
        mimeType: "image/png",
        dialogTitle: "Share Meet Recap",
      });

      posthog.capture("club_meet_recap_shared", {
        club_name: club,
        meet_name: meet,
      });
    } catch (error) {
      console.error("Error sharing image:", error);
      alert("Failed to share image");
    }
  };

  const topBar = (
    <View
      style={[
        styles.topBar,
        {
          paddingTop: insets.top + 8,
          paddingBottom: 12,
          backgroundColor: colors.background,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <Pressable
        onPress={() => router.back()}
        style={({ pressed }) => [
          styles.backButton,
          pressed && { opacity: 0.7 },
        ]}
        hitSlop={12}
      >
        <IconSymbol
          name={Platform.OS === "ios" ? "chevron.left" : "arrow.back"}
          size={24}
          color={colors.text}
        />
      </Pressable>
      <ThemedText
        style={[styles.topBarTitle, { color: colors.text }]}
        numberOfLines={1}
      >
        Meet Recap
      </ThemedText>
      <View style={styles.topBarSpacer} />
    </View>
  );

  if (isLoading) {
    return (
      <ThemedView
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <Stack.Screen options={{ headerShown: false }} />
        {topBar}
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.link} />
          <ThemedText
            style={[
              styles.emptyText,
              { color: colors.secondaryText, marginTop: 16 },
            ]}
          >
            Loading statistics...
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (error || !clubStats) {
    return (
      <ThemedView
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <Stack.Screen options={{ headerShown: false }} />
        {topBar}
        <View style={styles.centerContainer}>
          <ThemedText style={[styles.emptyTitle, { color: colors.text }]}>
            {isOffline ? "Offline" : "Error loading statistics"}
          </ThemedText>
          <ThemedText
            style={[styles.emptyText, { color: colors.secondaryText }]}
          >
            {isOffline
              ? "Meet results are not available without an internet connection"
              : error || "Unknown error"}
          </ThemedText>
          {!isOffline && (
            <Pressable
              style={[styles.retryButton, { backgroundColor: colors.link }]}
              onPress={loadStats}
            >
              <ThemedText style={styles.retryButtonText}>Retry</ThemedText>
            </Pressable>
          )}
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Stack.Screen options={{ headerShown: false }} />
      {topBar}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{
          paddingTop: 16,
          paddingBottom: Math.max(80, insets.bottom + 60),
        }}
      >
        {/* Club and Meet Header */}
        <View style={styles.header}>
          <ThemedText style={[styles.clubName, { color: colors.text }]}>
            {club}
          </ThemedText>
          <ThemedText
            style={[styles.meetName, { color: colors.secondaryText }]}
          >
            {meet}
          </ThemedText>
        </View>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <StatCard
            title="Athletes"
            value={clubStats.totalAthletes.toString()}
            icon={Platform.OS === "ios" ? "person.3.fill" : "people"}
            color={colors.link}
          />
          <StatCard
            title="Total Weight"
            value={`${Math.round(clubStats.totalWeightLifted)} kg`}
            icon={Platform.OS === "ios" ? "scalemass.fill" : "barbell"}
            color={colors.totalColor}
          />
          <StatCard
            title="Competition PRs"
            value={clubStats.totalPRs.toString()}
            icon={Platform.OS === "ios" ? "star.fill" : "star"}
            color={colors.prColor}
          />
          <StatCard
            title="Perfect 6/6"
            value={clubStats.perfect6for6.toString()}
            icon={
              Platform.OS === "ios"
                ? "checkmark.circle.fill"
                : "checkmark-circle"
            }
            color={colors.success}
          />
        </View>

        {/* Medals Section */}
        <View
          style={[styles.medalsContainer, { backgroundColor: colors.card }]}
        >
          <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>
            Medals
          </ThemedText>
          <View style={styles.medalsRow}>
            <MedalView
              count={clubStats.goldMedals}
              type="Gold"
              color={colors.gold}
            />
            <MedalView
              count={clubStats.silverMedals}
              type="Silver"
              color={colors.silver}
            />
            <MedalView
              count={clubStats.bronzeMedals}
              type="Bronze"
              color={colors.bronze}
            />
          </View>
        </View>

        {/* Share Button */}
        <View style={styles.shareButtonContainer}>
          <Pressable
            onPress={generateImage}
            disabled={isGeneratingImage || clubStats.totalAthletes === 0}
            style={({ pressed }) => [
              styles.mainShareButton,
              {
                backgroundColor: colors.link,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            {isGeneratingImage ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
              >
                <IconSymbol
                  name={Platform.OS === "ios" ? "square.and.arrow.up" : "share"}
                  size={20}
                  color="#FFFFFF"
                />
                <ThemedText style={styles.mainShareButtonText}>
                  Share Meet Recap
                </ThemedText>
              </View>
            )}
          </Pressable>
        </View>
      </ScrollView>

      {/* Hidden shareable view - rendered off-screen for image generation */}
      <View style={styles.offScreen}>
        <View ref={shareableViewRef} collapsable={false}>
          <ShareableRecapView
            club={club || ""}
            meet={meet || ""}
            stats={clubStats}
          />
        </View>
      </View>

      {/* Image Preview Modal */}
      <ImagePreviewModal
        visible={showPreview}
        imageUri={generatedImageUri}
        onClose={() => setShowPreview(false)}
        onShare={handleShare}
      />
    </ThemedView>
  );
}

// Stat Card Component
function StatCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: string;
  icon: string;
  color: string;
}) {
  const colors = useAppColors();

  return (
    <View style={[styles.statCard, { backgroundColor: colors.card }]}>
      <IconSymbol name={icon} size={30} color={colors.link} />
      <ThemedText style={styles.statValue}>{value}</ThemedText>
      <ThemedText style={styles.statTitle}>{title}</ThemedText>
    </View>
  );
}

// Medal View Component
function MedalView({
  count,
  type,
  color,
}: {
  count: number;
  type: string;
  color: string;
}) {
  return (
    <View style={styles.medalItem}>
      <View style={[styles.medalCircle, { backgroundColor: color }]}>
        <ThemedText style={styles.medalCount}>{count}</ThemedText>
      </View>
      <ThemedText style={styles.medalType}>{type}</ThemedText>
    </View>
  );
}

// Shareable Recap View (for image generation)
const ShareableRecapView = React.forwardRef<
  View,
  { club: string; meet: string; stats: ClubMeetStats }
>(({ club, meet, stats }, ref) => {
  const colors = useAppColors();

  return (
    <View ref={ref} style={shareableStyles.container}>
      <View style={shareableStyles.header}>
        <ThemedText style={shareableStyles.clubName}>{club}</ThemedText>
        <ThemedText style={shareableStyles.meetName}>{meet}</ThemedText>
      </View>

      <View style={shareableStyles.statsGrid}>
        <ShareableStatCard
          title="Athletes"
          value={stats.totalAthletes.toString()}
          emoji="👥"
          color={colors.link}
        />
        <ShareableStatCard
          title="Total Weight"
          value={`${Math.round(stats.totalWeightLifted)} kg`}
          emoji="⚖️"
          color={colors.totalColor}
        />
        <ShareableStatCard
          title="Competition PRs"
          value={stats.totalPRs.toString()}
          emoji="⭐"
          color={colors.prColor}
        />
        <ShareableStatCard
          title="Perfect 6/6"
          value={stats.perfect6for6.toString()}
          emoji="✅"
          color={colors.success}
        />
      </View>

      <View style={shareableStyles.medalsContainer}>
        <ThemedText style={shareableStyles.medalsTitle}>Medals</ThemedText>
        <View style={shareableStyles.medalsRow}>
          <ShareableMedalView
            count={stats.goldMedals}
            type="Gold"
            color={colors.gold}
          />
          <ShareableMedalView
            count={stats.silverMedals}
            type="Silver"
            color={colors.silver}
          />
          <ShareableMedalView
            count={stats.bronzeMedals}
            type="Bronze"
            color={colors.bronze}
          />
        </View>
      </View>

      <View style={shareableStyles.footer}>
        <ThemedText style={shareableStyles.footerText}>
          Generated by MeetCal
        </ThemedText>
        <Image
          source={require("@/assets/images/MeetCal-no-bg.png")}
          style={shareableStyles.logo}
          resizeMode="contain"
        />
      </View>
    </View>
  );
});

ShareableRecapView.displayName = "ShareableRecapView";

// Shareable Stat Card
function ShareableStatCard({
  title,
  value,
  emoji,
  color,
}: {
  title: string;
  value: string;
  emoji: string;
  color: string;
}) {
  return (
    <View style={shareableStyles.statCard}>
      <ThemedText style={[shareableStyles.statEmoji, { color }]}>
        {emoji}
      </ThemedText>
      <ThemedText style={shareableStyles.statValue}>{value}</ThemedText>
      <ThemedText style={shareableStyles.statTitle}>{title}</ThemedText>
    </View>
  );
}

// Shareable Medal View
function ShareableMedalView({
  count,
  type,
  color,
}: {
  count: number;
  type: string;
  color: string;
}) {
  return (
    <View style={shareableStyles.medalItem}>
      <View style={[shareableStyles.medalCircle, { backgroundColor: color }]}>
        <ThemedText style={shareableStyles.medalCount}>{count}</ThemedText>
      </View>
      <ThemedText style={shareableStyles.medalType}>{type}</ThemedText>
    </View>
  );
}

// Image Preview Modal Component
function ImagePreviewModal({
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
  const insets = useSafeAreaInsets();
  const colors = useAppColors();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <ThemedView
        style={[styles.modalContainer, { backgroundColor: colors.background }]}
      >
        <View
          style={[
            styles.modalHeader,
            Platform.OS === "android" && {
              paddingTop: Math.max(insets.top, 12) + 12,
            },
          ]}
        >
          <ThemedText style={[styles.modalTitle, { color: colors.text }]}>
            Recap Preview
          </ThemedText>
          <Pressable
            style={[
              styles.closeButton,
              Platform.OS === "android" && {
                top: Math.max(insets.top, 12) + 6,
              },
            ]}
            onPress={onClose}
          >
            <ThemedText
              style={{ color: colors.link, fontSize: 17, fontWeight: "600" }}
            >
              Done
            </ThemedText>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.modalContent}>
          {imageUri && (
            <>
              <Image
                source={{ uri: imageUri }}
                style={styles.previewImage}
                resizeMode="contain"
              />
              <Pressable style={styles.shareButton} onPress={onShare}>
                <IconSymbol
                  name={Platform.OS === "ios" ? "square.and.arrow.up" : "share"}
                  size={20}
                  color="#FFFFFF"
                />
                <ThemedText style={styles.shareButtonText}>
                  Share Recap
                </ThemedText>
              </Pressable>
            </>
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
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    paddingVertical: 8,
    paddingRight: 12,
  },
  topBarTitle: {
    fontSize: 17,
    fontWeight: "600",
    flex: 1,
    textAlign: "center",
  },
  topBarSpacer: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
  },
  retryButton: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  header: {
    paddingHorizontal: 20,
    alignItems: "center",
    gap: 8,
  },
  clubName: {
    fontSize: 28,
    fontWeight: "bold",
    textAlign: "center",
    paddingTop: 30,
  },
  meetName: {
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 16,
    gap: 16,
  },
  statCard: {
    width: "47%",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    gap: 8,
  },
  statValue: {
    fontSize: 28,
    lineHeight: 32,
    includeFontPadding: false,
    fontWeight: "bold",
  },
  statTitle: {
    fontSize: 12,
    color: "#8E8E93",
  },
  medalsContainer: {
    margin: 16,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 16,
  },
  medalsRow: {
    flexDirection: "row",
    gap: 30,
  },
  medalItem: {
    alignItems: "center",
    gap: 8,
  },
  medalCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: "center",
    alignItems: "center",
  },
  medalCount: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#FFFFFF",
  },
  medalType: {
    fontSize: 12,
    color: "#8E8E93",
  },
  shareButtonContainer: {
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  mainShareButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  mainShareButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
  offScreen: {
    position: "absolute",
    left: -10000,
    top: 0,
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E1E1E1",
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  closeButton: {
    position: "absolute",
    right: 16,
  },
  modalContent: {
    padding: 20,
    alignItems: "center",
    gap: 20,
  },
  previewImage: {
    width: "100%",
    aspectRatio: 0.8,
    borderRadius: 12,
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
  },
  shareButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
});

// Shareable view styles (for image generation)
const shareableStyles = StyleSheet.create({
  container: {
    width: 800,
    height: 1000,
    backgroundColor: "#FFFFFF",
    padding: 0,
  },
  header: {
    paddingVertical: 40,
    alignItems: "center",
    gap: 12,
  },
  clubName: {
    fontSize: 36,
    fontWeight: "bold",
    color: "#000000",
    textAlign: "center",
    lineHeight: 42,
  },
  meetName: {
    fontSize: 24,
    fontWeight: "600",
    color: "#007AFF",
    textAlign: "center",
    lineHeight: 30,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 30,
    gap: 20,
    justifyContent: "space-between",
  },
  statCard: {
    width: "47%",
    paddingVertical: 30,
    backgroundColor: "#F2F2F7",
    borderRadius: 16,
    alignItems: "center",
    gap: 12,
  },
  statEmoji: {
    fontSize: 48,
    lineHeight: 54,
  },
  statValue: {
    fontSize: 36,
    fontWeight: "bold",
    color: "#000000",
    lineHeight: 42,
  },
  statTitle: {
    fontSize: 14,
    color: "#8E8E93",
    lineHeight: 18,
  },
  medalsContainer: {
    marginTop: 30,
    marginHorizontal: 30,
    padding: 20,
    backgroundColor: "#F2F2F7",
    borderRadius: 20,
    alignItems: "center",
  },
  medalsTitle: {
    fontSize: 28,
    fontWeight: "600",
    color: "#000000",
    marginBottom: 20,
    lineHeight: 34,
  },
  medalsRow: {
    flexDirection: "row",
    gap: 50,
    paddingBottom: 20,
  },
  medalItem: {
    alignItems: "center",
    gap: 12,
  },
  medalCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  medalCount: {
    fontSize: 36,
    fontWeight: "bold",
    color: "#FFFFFF",
    lineHeight: 42,
  },
  medalType: {
    fontSize: 16,
    color: "#8E8E93",
    lineHeight: 20,
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  footerText: {
    fontSize: 14,
    color: "#8E8E93",
    lineHeight: 18,
  },
  logo: {
    width: 30,
    height: 30,
  },
});
