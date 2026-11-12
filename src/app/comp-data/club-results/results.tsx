import { ClubRecapHero } from "@/components/club-results/ClubRecapHero";
import { ClubRecapStats } from "@/components/club-results/ClubRecapStats";
import { ClubRecapTopBar } from "@/components/club-results/ClubRecapTopBar";
import { RecapPreviewModal } from "@/components/club-results/RecapPreviewModal";
import { ShareableRecapView } from "@/components/club-results/ShareableRecapView";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { useIsOffline } from "@/hooks/useIsOffline";
import { SubscriptionGate } from "@/components/ui/SubscriptionGate";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { useAppColors } from "@/hooks/useAppColors";
import { useMutableResource } from "@/hooks/useMutableResource";
import { useRecapEntryAnimation } from "@/hooks/useRecapEntryAnimation";
import { clubMeetStatsResource } from "@/lib/database/fetch-club-stats";
import { posthog } from "@/lib/posthog";
import { captureViewAsPng, shareImageFile } from "@/lib/share-image";
import { showToast } from "@/components/ui/Toast";
import type { ClubMeetStats } from "@/types/club";
import { Stack, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useScreenHorizontalInsets } from "@/hooks/useScreenInsets";
import { Palette } from "@/constants/Palette";

export default function MeetResultsByClubScreen() {
  return (
    <SubscriptionGate>
      <MeetResultsByClubScreenContent />
    </SubscriptionGate>
  );
}

function MeetResultsByClubScreenContent() {
  const screenInsets = useScreenHorizontalInsets();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { club, meet } = useLocalSearchParams<{ club: string; meet: string }>();

  const [showPreview, setShowPreview] = useState(false);
  const [generatedImageUri, setGeneratedImageUri] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isOffline] = useIsOffline();
  const params = useMemo<[string, string] | null>(
    () => (club && meet ? [club, meet] : null),
    [club, meet],
  );
  const {
    data: clubStats,
    isInitialLoading: isLoading,
    error,
    refresh,
  } = useMutableResource({
    resource: clubMeetStatsResource,
    screen: "club-results/results",
    params,
    initialData: null as ClubMeetStats | null,
  });

  const shareableViewRef = useRef<React.ComponentRef<typeof View>>(null);
  const { headerFade, statsSlide, shareSlide } = useRecapEntryAnimation(clubStats);

  useEffect(() => {
    posthog.capture("screen_viewed", {
      screen_name: "Meet Results By Club",
      club_name: club,
      meet_name: meet,
    });
  }, [club, meet]);

  const loadStats = useCallback(async () => {
    await refresh();
  }, [refresh]);

  const generateImage = async () => {
    if (!shareableViewRef.current || !clubStats || clubStats.totalAthletes === 0) return;

    setIsGeneratingImage(true);

    try {
      const uri = await captureViewAsPng(shareableViewRef.current);

      setGeneratedImageUri(uri);
      setShowPreview(true);

      posthog.capture("club_meet_recap_generated", {
        club_name: club,
        meet_name: meet,
      });
    } catch (err) {
      console.error("Error generating image:", err);
      showToast({ type: "error", message: "Failed to generate image" });
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleShare = async () => {
    if (!generatedImageUri) return;

    try {
      await shareImageFile(generatedImageUri, "Share Meet Recap");

      posthog.capture("club_meet_recap_shared", {
        club_name: club,
        meet_name: meet,
      });
    } catch (err) {
      console.error("Error sharing image:", err);
      showToast({ type: "error", message: "Failed to share image" });
    }
  };

  if (isLoading) {
    return (
      <ThemedView style={[styles.container, { backgroundColor: colors.background }, screenInsets]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ClubRecapTopBar />
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
      <ThemedView style={[styles.container, { backgroundColor: colors.background }, screenInsets]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ClubRecapTopBar />
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
              accessibilityRole="button"
            >
              <ThemedText style={styles.retryButtonText}>Retry</ThemedText>
            </Pressable>
          )}
        </View>
      </ThemedView>
    );
  }

  const hasNoAthletes = clubStats.totalAthletes === 0;

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }, screenInsets]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ClubRecapTopBar />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{
          paddingBottom: Math.max(80, insets.bottom + 60),
        }}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: headerFade }}>
          <ClubRecapHero
            club={club}
            meet={meet}
            stats={clubStats}
            colors={colors}
          />
        </Animated.View>

        <Animated.View
          style={{
            opacity: headerFade,
            transform: [{ translateY: statsSlide }],
          }}
        >
          <ClubRecapStats stats={clubStats} colors={colors} />
        </Animated.View>

        <Animated.View
          style={{
            opacity: headerFade,
            transform: [{ translateY: shareSlide }],
          }}
        >
          <View style={styles.shareButtonContainer}>
            <Pressable
              onPress={generateImage}
              disabled={isGeneratingImage || hasNoAthletes}
              accessibilityRole="button"
              accessibilityLabel="Share Meet Recap"
              accessibilityState={{
                busy: isGeneratingImage,
                disabled: isGeneratingImage || hasNoAthletes,
              }}
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
                <ActivityIndicator size="small" color={Palette.white} />
              ) : (
                <View style={styles.mainShareButtonContent}>
                  <IconSymbol
                    name={Platform.OS === "ios" ? "square.and.arrow.up" : "share"}
                    size={20}
                    color={Palette.white}
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

      <View style={styles.offScreen}>
        <View ref={shareableViewRef} collapsable={false}>
          <ShareableRecapView
            club={club || ""}
            meet={meet || ""}
            stats={clubStats}
          />
        </View>
      </View>

      <RecapPreviewModal
        visible={showPreview}
        imageUri={generatedImageUri}
        onClose={() => setShowPreview(false)}
        onShare={handleShare}
      />
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
    color: Palette.white,
    fontSize: 16,
    fontWeight: "600",
  },
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
  mainShareButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  mainShareButtonText: {
    color: Palette.white,
    fontSize: 17,
    fontWeight: "600",
  },
  offScreen: {
    position: "absolute",
    left: -10000,
    top: 0,
  },
});
