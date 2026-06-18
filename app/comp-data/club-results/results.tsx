import { IconSymbol } from "@/components/ui/IconSymbol";
import { SubscriptionGate } from "@/components/ui/SubscriptionGate";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { useAppColors } from "@/hooks/useAppColors";
import { useMutableResource } from "@/hooks/useMutableResource";
import { clubMeetStatsResource } from "@/lib/database/fetch-club-stats";
import {
  isNetworkAvailable,
  subscribeToNetworkChanges,
} from "@/lib/networkUtils";
import { posthog } from "@/lib/posthog";
import type { ClubMeetStats } from "@/types/club";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { captureRef } from "react-native-view-shot";

export default function MeetResultsByClubScreen() {
  return (
    <SubscriptionGate>
      <MeetResultsByClubScreenContent />
    </SubscriptionGate>
  );
}

function MeetResultsByClubScreenContent() {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { club, meet } = useLocalSearchParams<{ club: string; meet: string }>();

  const [showPreview, setShowPreview] = useState(false);
  const [generatedImageUri, setGeneratedImageUri] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const params = useMemo(
    () => (club && meet ? ([club, meet] as const) : null),
    [club, meet],
  );
  const {
    data: clubStats,
    isInitialLoading: isLoading,
    error,
    refresh,
  } = useMutableResource({
    resource: clubMeetStatsResource,
    params: (params ?? (["", ""] as const)) as [string, string],
    initialData: null as ClubMeetStats | null,
    enabled: Boolean(params),
  });

  const shareableViewRef = useRef<View>(null);

  // Animations
  const headerFade = useRef(new Animated.Value(0)).current;
  const statsSlide = useRef(new Animated.Value(24)).current;
  const shareSlide = useRef(new Animated.Value(24)).current;

  const runEntryAnimation = useCallback(() => {
    Animated.stagger(80, [
      Animated.timing(headerFade, {
        toValue: 1,
        duration: 450,
        useNativeDriver: true,
      }),
      Animated.timing(statsSlide, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.timing(shareSlide, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();
  }, [headerFade, shareSlide, statsSlide]);

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
    await refresh();
  }, [refresh]);

  useEffect(() => {
    if (clubStats) {
      runEntryAnimation();
    }
  }, [clubStats]);

  const generateImage = async () => {
    if (!shareableViewRef.current || !clubStats || clubStats.totalAthletes === 0) return;

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
    } catch (err) {
      console.error("Error sharing image:", err);
      alert("Failed to share image");
    }
  };

  const topBar = (
    <View
      style={[
        styles.topBar,
        {
          paddingTop: insets.top + 8,
          paddingBottom: 14,
          backgroundColor: colors.background,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <Pressable
        onPress={() => router.back()}
        style={({ pressed }) => [
          styles.backButton,
          pressed && { opacity: 0.6 },
        ]}
        hitSlop={12}
      >
        <IconSymbol
          name={Platform.OS === "ios" ? "chevron.left" : "arrow.back"}
          size={24}
          color={colors.text}
        />
      </Pressable>
      <View style={styles.topBarCenter}>
        <ThemedText style={[styles.topBarLabel, { color: colors.secondaryText }]}>
          MEET RECAP
        </ThemedText>
      </View>
      <View style={styles.topBarSpacer} />
    </View>
  );

  if (isLoading) {
    return (
      <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        {topBar}
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.link} />
          <ThemedText style={[styles.emptyText, { color: colors.secondaryText, marginTop: 16 }]}>
            Loading statistics...
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (error || !clubStats) {
    return (
      <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        {topBar}
        <View style={styles.centerContainer}>
          <ThemedText style={[styles.emptyTitle, { color: colors.text }]}>
            {isOffline ? "Offline" : "Error loading statistics"}
          </ThemedText>
          <ThemedText style={[styles.emptyText, { color: colors.secondaryText }]}>
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

  const totalMedals = clubStats.goldMedals + clubStats.silverMedals + clubStats.bronzeMedals;

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      {topBar}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{
          paddingBottom: Math.max(80, insets.bottom + 60),
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Banner */}
        <Animated.View style={{ opacity: headerFade }}>
          <View style={[styles.heroBanner, { backgroundColor: colors.card }]}>
            {/* Gold accent bar */}
            <View style={styles.heroAccentBar} />

            <ThemedText style={[styles.heroClubName, { color: colors.text }]}>
              {club}
            </ThemedText>
            <ThemedText style={[styles.heroMeetName, { color: colors.secondaryText }]}>
              {meet}
            </ThemedText>

            {/* Medal chips */}
            {totalMedals > 0 && (
              <View style={styles.medalChipsRow}>
                {clubStats.goldMedals > 0 && (
                  <View style={[styles.medalChip, { backgroundColor: "rgba(255,215,0,0.15)" }]}>
                    <Text style={styles.medalChipEmoji}>🥇</Text>
                    <ThemedText style={[styles.medalChipCount, { color: colors.gold }]}>
                      {clubStats.goldMedals}
                    </ThemedText>
                    <ThemedText style={[styles.medalChipLabel, { color: colors.secondaryText }]}>
                      Gold
                    </ThemedText>
                  </View>
                )}
                {clubStats.silverMedals > 0 && (
                  <View style={[styles.medalChip, { backgroundColor: "rgba(192,192,192,0.15)" }]}>
                    <Text style={styles.medalChipEmoji}>🥈</Text>
                    <ThemedText style={[styles.medalChipCount, { color: colors.silver }]}>
                      {clubStats.silverMedals}
                    </ThemedText>
                    <ThemedText style={[styles.medalChipLabel, { color: colors.secondaryText }]}>
                      Silver
                    </ThemedText>
                  </View>
                )}
                {clubStats.bronzeMedals > 0 && (
                  <View style={[styles.medalChip, { backgroundColor: "rgba(205,127,50,0.15)" }]}>
                    <Text style={styles.medalChipEmoji}>🥉</Text>
                    <ThemedText style={[styles.medalChipCount, { color: colors.bronze }]}>
                      {clubStats.bronzeMedals}
                    </ThemedText>
                    <ThemedText style={[styles.medalChipLabel, { color: colors.secondaryText }]}>
                      Bronze
                    </ThemedText>
                  </View>
                )}
              </View>
            )}
          </View>
        </Animated.View>

        {/* Stats Grid */}
        <Animated.View
          style={{
            opacity: headerFade,
            transform: [{ translateY: statsSlide }],
          }}
        >
          <View style={styles.statsGrid}>
            <PremiumStatCard
              title="Athletes"
              value={clubStats.totalAthletes.toString()}
              icon={Platform.OS === "ios" ? "person.3.fill" : "people"}
              accentColor={colors.link}
              colors={colors}
            />
            <PremiumStatCard
              title="Total Weight"
              value={`${Math.round(clubStats.totalWeightLifted)} kg`}
              icon={Platform.OS === "ios" ? "scalemass.fill" : "barbell"}
              accentColor={colors.totalColor}
              colors={colors}
            />
            <PremiumStatCard
              title="Comp PRs"
              value={clubStats.totalPRs.toString()}
              icon={Platform.OS === "ios" ? "star.fill" : "star"}
              accentColor={colors.prColor}
              colors={colors}
            />
            <PremiumStatCard
              title="Perfect 6/6"
              value={clubStats.perfect6for6.toString()}
              icon={Platform.OS === "ios" ? "checkmark.circle.fill" : "checkmark-circle"}
              accentColor={colors.success}
              colors={colors}
            />
          </View>
          <View style={styles.makeRateRow}>
            <MakeRateCard
              title="Snatch"
              value={formatMakeRate(clubStats.snatchMakeRate)}
              accentColor={colors.fail}
              colors={colors}
            />
            <MakeRateCard
              title="C&J"
              value={formatMakeRate(clubStats.cjMakeRate)}
              accentColor={colors.success}
              colors={colors}
            />
            <MakeRateCard
              title="Overall"
              value={formatMakeRate(clubStats.combinedMakeRate)}
              accentColor={colors.link}
              colors={colors}
            />
          </View>
        </Animated.View>

        {/* Share Button */}
        <Animated.View
          style={{
            opacity: headerFade,
            transform: [{ translateY: shareSlide }],
          }}
        >
          <View style={styles.shareButtonContainer}>
            <Pressable
              onPress={generateImage}
              disabled={isGeneratingImage || clubStats.totalAthletes === 0}
              style={({ pressed }) => [
                styles.mainShareButton,
                {
                  backgroundColor: colors.link,
                  shadowColor: colors.link,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              {isGeneratingImage ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
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
        </Animated.View>
      </ScrollView>

      {/* Hidden shareable view */}
      <View style={styles.offScreen}>
        <View ref={shareableViewRef} collapsable={false}>
          <ShareableRecapView
            club={club || ""}
            meet={meet || ""}
            stats={clubStats}
          />
        </View>
      </View>

      <ImagePreviewModal
        visible={showPreview}
        imageUri={generatedImageUri}
        onClose={() => setShowPreview(false)}
        onShare={handleShare}
      />
    </ThemedView>
  );
}

// Premium Stat Card
function PremiumStatCard({
  title,
  value,
  icon,
  accentColor,
  colors,
}: {
  title: string;
  value: string;
  icon: string;
  accentColor: string;
  colors: ReturnType<typeof useAppColors>;
}) {
  return (
    <View
      style={[
        styles.statCard,
        {
          backgroundColor: colors.card,
          borderTopColor: accentColor,
        },
      ]}
    >
      <IconSymbol name={icon} size={26} color={accentColor} />
      <ThemedText style={[styles.statValue, { color: colors.text }]}>{value}</ThemedText>
      <ThemedText style={[styles.statTitle, { color: colors.secondaryText }]}>{title}</ThemedText>
    </View>
  );
}

// Shareable Recap View (800x1000, dark premium)
const ShareableRecapView = React.forwardRef<
  View,
  { club: string; meet: string; stats: ClubMeetStats }
>(({ club, meet, stats }, ref) => {
  return (
    <View ref={ref} style={shareableStyles.container}>

      {/* Branding row */}
      <View style={shareableStyles.brandingRow}>
        <Image
          source={require("@/assets/images/MeetCal-no-bg.png")}
          style={shareableStyles.brandLogo}
          resizeMode="contain"
        />
        <Text style={shareableStyles.brandName}>MeetCal</Text>
        <View style={shareableStyles.brandDot} />
        <Text style={shareableStyles.brandTag}>MEET RECAP</Text>
      </View>

      {/* Gold separator */}
      <View style={shareableStyles.goldSeparator} />

      {/* Club + Meet name */}
      <Text style={shareableStyles.clubName} numberOfLines={2}>
        {club}
      </Text>
      <Text style={shareableStyles.meetName}>{meet}</Text>

      {/* Medal Row */}
      <View style={shareableStyles.medalRow}>
        <ShareableMedalBlock
          count={stats.goldMedals}
          label="GOLD"
          emoji="🥇"
          borderColor="rgba(255,215,0,0.35)"
        />
        <ShareableMedalBlock
          count={stats.silverMedals}
          label="SILVER"
          emoji="🥈"
          borderColor="rgba(192,192,192,0.2)"
        />
        <ShareableMedalBlock
          count={stats.bronzeMedals}
          label="BRONZE"
          emoji="🥉"
          borderColor="rgba(205,127,50,0.2)"
        />
      </View>

      {/* Stats Grid */}
      <View style={shareableStyles.statsGrid}>
        <ShareableStatCard
          emoji="👥"
          value={stats.totalAthletes.toString()}
          label="ATHLETES"
          accentColor="#007AFF"
        />
        <ShareableStatCard
          emoji="⚖️"
          value={`${Math.round(stats.totalWeightLifted)} kg`}
          label="TOTAL WEIGHT"
          accentColor="#AF52DE"
        />
        <ShareableStatCard
          emoji="⭐"
          value={stats.totalPRs.toString()}
          label="COMP PRs"
          accentColor="#FF9500"
        />
        <ShareableStatCard
          emoji="✅"
          value={stats.perfect6for6.toString()}
          label="PERFECT 6/6"
          accentColor="#34C759"
        />
      </View>

      <View style={shareableStyles.makeRateRow}>
        <ShareableMakeRateCard
          value={formatMakeRate(stats.snatchMakeRate)}
          label="SNATCH MAKE"
          accentColor="#FF375F"
        />
        <ShareableMakeRateCard
          value={formatMakeRate(stats.cjMakeRate)}
          label="C&J MAKE"
          accentColor="#32D74B"
        />
        <ShareableMakeRateCard
          value={formatMakeRate(stats.combinedMakeRate)}
          label="OVERALL MAKE"
          accentColor="#FFD60A"
        />
      </View>

    </View>
  );
});

ShareableRecapView.displayName = "ShareableRecapView";

function formatMakeRate(rate: number | undefined) {
  return `${Math.round(rate ?? 0)}%`;
}

// Shareable Medal Block
function ShareableMedalBlock({
  count,
  label,
  emoji,
  borderColor,
}: {
  count: number;
  label: string;
  emoji: string;
  borderColor: string;
}) {
  const medalColors: Record<string, string> = {
    GOLD: "#FFD700",
    SILVER: "#C0C0C0",
    BRONZE: "#CD7F32",
  };
  return (
    <View style={[shareableStyles.medalBlock, { borderColor }]}>
      <Text style={shareableStyles.medalBlockEmoji}>{emoji}</Text>
      <Text style={[shareableStyles.medalBlockCount, { color: medalColors[label] ?? "#FFFFFF" }]}>
        {count}
      </Text>
      <Text style={shareableStyles.medalBlockLabel}>{label}</Text>
    </View>
  );
}

// Shareable Stat Card
function ShareableStatCard({
  emoji,
  value,
  label,
  accentColor,
}: {
  emoji: string;
  value: string;
  label: string;
  accentColor: string;
}) {
  return (
    <View style={[shareableStyles.statCard, { borderTopColor: accentColor }]}>
      <Text style={shareableStyles.statEmoji}>{emoji}</Text>
      <Text style={shareableStyles.statValue}>{value}</Text>
      <Text style={shareableStyles.statLabel}>{label}</Text>
    </View>
  );
}

function MakeRateCard({
  title,
  value,
  accentColor,
  colors,
}: {
  title: string;
  value: string;
  accentColor: string;
  colors: ReturnType<typeof useAppColors>;
}) {
  return (
    <View
      style={[
        styles.makeRateCard,
        {
          backgroundColor: colors.card,
          borderTopColor: accentColor,
        },
      ]}
    >
      <IconSymbol name="stats-chart" size={20} color={accentColor} />
      <ThemedText style={[styles.makeRateValue, { color: colors.text }]}>
        {value}
      </ThemedText>
      <ThemedText style={[styles.makeRateTitle, { color: colors.secondaryText }]}>
        {title}
      </ThemedText>
    </View>
  );
}

function ShareableMakeRateCard({
  value,
  label,
  accentColor,
}: {
  value: string;
  label: string;
  accentColor: string;
}) {
  return (
    <View style={[shareableStyles.makeRateCard, { borderTopColor: accentColor }]}>
      <Text style={shareableStyles.makeRateValue}>{value}</Text>
      <Text style={shareableStyles.makeRateLabel}>{label}</Text>
    </View>
  );
}

// Image Preview Modal
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
      <ThemedView style={[styles.modalContainer, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.modalHeader,
            Platform.OS === "android" && {
              paddingTop: Math.max(insets.top, 12) + 12,
            },
            { borderBottomColor: colors.border },
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
            <ThemedText style={{ color: colors.link, fontSize: 17, fontWeight: "600" }}>
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
              <Pressable
                style={[styles.shareButton, { backgroundColor: colors.link, shadowColor: colors.link }]}
                onPress={onShare}
              >
                <IconSymbol
                  name={Platform.OS === "ios" ? "square.and.arrow.up" : "share"}
                  size={20}
                  color="#FFFFFF"
                />
                <ThemedText style={styles.shareButtonText}>Share Recap</ThemedText>
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
    width: 44,
  },
  topBarCenter: {
    flex: 1,
    alignItems: "center",
  },
  topBarLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2,
  },
  topBarSpacer: {
    width: 44,
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
    borderRadius: 10,
  },
  retryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  // Hero banner
  heroBanner: {
    margin: 16,
    marginBottom: 8,
    padding: 24,
    borderRadius: 20,
    overflow: "hidden",
  },
  heroAccentBar: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: "#FFD700",
    borderTopLeftRadius: 20,
    borderBottomLeftRadius: 20,
  },
  heroClubName: {
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.5,
    lineHeight: 34,
  },
  heroMeetName: {
    fontSize: 15,
    fontWeight: "500",
    marginTop: 6,
  },
  medalChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 18,
  },
  medalChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  medalChipEmoji: {
    fontSize: 16,
  },
  medalChipCount: {
    fontSize: 15,
    fontWeight: "700",
  },
  medalChipLabel: {
    fontSize: 13,
    fontWeight: "500",
  },
  // Stats grid
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: 16,
    paddingTop: 8,
    gap: 12,
  },
  statCard: {
    flex: 1,
    minWidth: "45%",
    padding: 18,
    borderRadius: 16,
    alignItems: "flex-start",
    gap: 6,
    borderTopWidth: 3,
  },
  statValue: {
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: -1,
    lineHeight: 36,
    includeFontPadding: false,
    marginTop: 6,
  },
  statTitle: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  makeRateRow: {
    flexDirection: "row",
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
  },
  makeRateCard: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    alignItems: "flex-start",
    gap: 5,
    borderTopWidth: 3,
  },
  makeRateValue: {
    fontSize: 24,
    fontWeight: "800",
    lineHeight: 28,
    includeFontPadding: false,
  },
  makeRateTitle: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  // Share button
  shareButtonContainer: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
  },
  mainShareButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
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
  // Modal
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
    aspectRatio: 800 / 1000,
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
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
});

// Shareable image styles (dark premium, 800x1000)
const shareableStyles = StyleSheet.create({
  container: {
    width: 800,
    height: 1000,
    backgroundColor: "#0A0A0F",
    padding: 50,
    overflow: "hidden",
  },
  brandingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
  },
  brandLogo: {
    width: 22,
    height: 22,
  },
  brandName: {
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },
  brandDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#FFD700",
  },
  brandTag: {
    fontSize: 11,
    fontWeight: "700",
    color: "#8E8E93",
    letterSpacing: 2,
  },
  goldSeparator: {
    height: 2,
    backgroundColor: "#FFD700",
    opacity: 0.6,
    borderRadius: 1,
    marginBottom: 24,
  },
  clubName: {
    fontSize: 52,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -1.5,
    lineHeight: 58,
    marginBottom: 8,
  },
  meetName: {
    fontSize: 20,
    fontWeight: "500",
    color: "#8E8E93",
    letterSpacing: 0.2,
    marginBottom: 24,
  },
  // Medals
  medalRow: {
    flexDirection: "row",
    gap: 14,
    marginBottom: 24,
  },
  medalBlock: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 12,
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
  },
  medalBlockEmoji: {
    fontSize: 36,
    lineHeight: 40,
  },
  medalBlockCount: {
    fontSize: 48,
    fontWeight: "900",
    lineHeight: 52,
    includeFontPadding: false,
    letterSpacing: -1,
  },
  medalBlockLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#8E8E93",
    letterSpacing: 1.5,
  },
  // Stats grid
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 14,
    marginBottom: 24,
  },
  statCard: {
    width: "49%",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 20,
    borderTopWidth: 3,
    gap: 8,
  },
  statEmoji: {
    fontSize: 30,
    lineHeight: 34,
  },
  statValue: {
    fontSize: 40,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: -1,
    lineHeight: 44,
    includeFontPadding: false,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#8E8E93",
    letterSpacing: 1.2,
  },
  makeRateRow: {
    flexDirection: "row",
    gap: 12,
  },
  makeRateCard: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 14,
    alignItems: "center",
    borderTopWidth: 3,
    gap: 8,
  },
  makeRateValue: {
    fontSize: 38,
    fontWeight: "900",
    color: "#FFFFFF",
    lineHeight: 42,
    includeFontPadding: false,
  },
  makeRateLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#8E8E93",
    letterSpacing: 1,
  },
});
