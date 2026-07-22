import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { showToast } from "@/components/ui/Toast";
import { useAppColors } from "@/hooks/useAppColors";
import {
  claimAndroidReward,
  claimIosReward,
  fetchReferral,
  MeetCalApiError,
  releaseIosReward,
  type ApiReferralReward,
  type ApiReferralSummary,
} from "@/lib/api/meetcal-api";
import { isIosOfferOutstanding } from "@/utils/referral";
import { useAuth } from "@clerk/expo";
import { Stack } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from "react-native";
import Purchases, {
  type PurchasesPromotionalOffer,
} from "react-native-purchases";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const MILESTONE = 5;

const SHARE_OFFER_COPY =
  "For every 5 friends who become new paid subscribers, you earn 1 month free";

const REWARD_STATUS_LABEL: Record<ApiReferralReward["status"], string> = {
  earned: "Ready to claim",
  claimed: "Claim in progress",
  delivering: "Delivering",
  delivered: "Delivered",
  reversed: "Reversed",
  failed: "Failed",
};

function formatEarnedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ReferralScreen() {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();

  const [summary, setSummary] = useState<ApiReferralSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [claimingId, setClaimingId] = useState<number | null>(null);
  // Immediate post-purchase bridge: rewards just claimed on this device, held
  // locally until the refetch surfaces the backend's ios_offer_issued_at. The
  // persistent scheduled state is derived from that timestamp (see below), so
  // this set only needs to cover the gap before load() lands.
  const [scheduledIds, setScheduledIds] = useState<Set<number>>(new Set());

  // Guards every async setState path against updates after unmount.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) throw new Error("Missing Clerk token");
      const result = await fetchReferral(token);
      if (!isMountedRef.current) return;
      setSummary(result);
      setError(false);
    } catch (e) {
      console.error("Failed to load referral summary:", e);
      if (isMountedRef.current) setError(true);
    }
  }, [getToken]);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      await load();
      if (isMountedRef.current) setIsLoading(false);
    })();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await load();
    if (isMountedRef.current) setIsRefreshing(false);
  }, [load]);

  const handleShare = useCallback(async () => {
    if (!summary) return;
    try {
      await Share.share({
        message: `${SHARE_OFFER_COPY}.\n\n${summary.share_url}`,
      });
    } catch (e) {
      console.error("Failed to share referral link:", e);
    }
  }, [summary]);

  const handleClaimAndroid = useCallback(
    async (reward: ApiReferralReward) => {
      setClaimingId(reward.id);
      try {
        const token = await getToken();
        if (!token) throw new Error("Missing Clerk token");
        await claimAndroidReward(token, reward.id);
        await load();
        showToast({
          type: "success",
          message:
            "Free month claimed! Your next billing date moves 30 days later.",
        });
      } catch (e) {
        if (e instanceof MeetCalApiError && e.status === 409) {
          // Already claimed/in progress elsewhere — reconcile from the server.
          await load();
          showToast({
            type: "info",
            message: "This free month is already being applied.",
          });
        } else if (e instanceof MeetCalApiError && e.status === 503) {
          showToast({
            type: "error",
            message: "Reward claiming is temporarily unavailable. Try again later.",
          });
        } else {
          console.error("Failed to claim Android reward:", e);
          showToast({
            type: "error",
            message: "Couldn't claim your free month. Please try again.",
          });
        }
      } finally {
        if (isMountedRef.current) setClaimingId(null);
      }
    },
    [getToken, load],
  );

  const handleClaimIos = useCallback(
    async (reward: ApiReferralReward) => {
      setClaimingId(reward.id);
      try {
        const token = await getToken();
        if (!token) throw new Error("Missing Clerk token");

        // Fetch the Apple promotional-offer signature bundle from the backend.
        const offer = await claimIosReward(token, reward.id);

        // Resolve the store product the offer applies to.
        const products = await Purchases.getProducts([offer.product_id]);
        const product = products.find((p) => p.identifier === offer.product_id);
        if (!product) {
          throw new Error(`Product ${offer.product_id} not found`);
        }

        // The backend already signed the offer, so we build the
        // PurchasesPromotionalOffer directly rather than calling
        // getPromotionalOffer (which would re-sign via RevenueCat).
        const promotionalOffer: PurchasesPromotionalOffer = {
          identifier: offer.offer_id,
          keyIdentifier: offer.key_id,
          nonce: offer.nonce,
          signature: offer.signature,
          timestamp: offer.timestamp,
        };

        await Purchases.purchaseDiscountedProduct(product, promotionalOffer);

        // The backend hands out the signature without consuming the reward; it
        // flips to "delivered" only when RevenueCat reports the redemption.
        // Mark it scheduled locally so the Claim button doesn't reappear.
        if (isMountedRef.current) {
          setScheduledIds((prev) => {
            const next = new Set(prev);
            next.add(reward.id);
            return next;
          });
        }
        await load();
        showToast({
          type: "success",
          message: "Free month scheduled! It applies at your next renewal.",
        });
      } catch (e) {
        // User backed out of Apple's sheet: the reward is still claimable, but
        // the backend already reserved it (ios_offer_issued_at) when it handed
        // out the signature. Release that reservation so the reward doesn't show
        // as "scheduled" and re-claims aren't blocked for the throttle window.
        if (
          e &&
          typeof e === "object" &&
          "userCancelled" in e &&
          (e as { userCancelled?: boolean }).userCancelled
        ) {
          try {
            const token = await getToken();
            if (token) await releaseIosReward(token, reward.id);
          } catch (releaseErr) {
            // Best-effort: the throttle lapses on its own if this fails.
            console.warn("Failed to release iOS offer reservation:", releaseErr);
          }
          if (isMountedRef.current) {
            setScheduledIds((prev) => {
              if (!prev.has(reward.id)) return prev;
              const next = new Set(prev);
              next.delete(reward.id);
              return next;
            });
          }
          await load();
          return;
        }
        if (e instanceof MeetCalApiError && e.status === 409) {
          // An offer is already outstanding for this reward (~48h window).
          // Treat as already-scheduled: bridge locally, then reconcile.
          if (isMountedRef.current) {
            setScheduledIds((prev) => {
              const next = new Set(prev);
              next.add(reward.id);
              return next;
            });
          }
          await load();
          showToast({
            type: "info",
            message: "Your free month is already scheduled for your next renewal.",
          });
          return;
        }
        if (e instanceof MeetCalApiError && e.status === 503) {
          showToast({
            type: "error",
            message: "Reward claiming is temporarily unavailable. Try again later.",
          });
        } else {
          console.error("Failed to claim iOS reward:", e);
          showToast({
            type: "error",
            message: "Couldn't claim your free month. Please try again.",
          });
        }
      } finally {
        if (isMountedRef.current) setClaimingId(null);
      }
    },
    [getToken, load],
  );

  const confirmAndClaim = useCallback(
    (reward: ApiReferralReward) => {
      if (Platform.OS === "ios") {
        Alert.alert(
          "Claim Your Free Month",
          "Your next renewal includes 30 days free, then renews at the normal price.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Continue",
              onPress: () => {
                void handleClaimIos(reward);
              },
            },
          ],
        );
        return;
      }

      Alert.alert(
        "Claim Your Free Month",
        "Your next billing date will move 30 days later. Continue?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Claim",
            onPress: () => {
              void handleClaimAndroid(reward);
            },
          },
        ],
      );
    },
    [handleClaimAndroid, handleClaimIos],
  );

  const headerOptions = (
    <Stack.Screen
      options={{
        headerTitle: "Refer Friends",
        headerTitleStyle: { color: colors.text },
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
      }}
    />
  );

  if (isLoading) {
    return (
      <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
        {headerOptions}
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.link} />
        </View>
      </ThemedView>
    );
  }

  if (error || !summary) {
    return (
      <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
        {headerOptions}
        <View style={styles.centered}>
          <ThemedText style={[styles.errorText, { color: colors.secondaryText }]}>
            We couldn&apos;t load your referral rewards. Pull to try again.
          </ThemedText>
          <Pressable
            style={[styles.primaryButton, { backgroundColor: colors.link }]}
            onPress={onRefresh}
          >
            <ThemedText style={styles.primaryButtonText}>Retry</ThemedText>
          </Pressable>
        </View>
      </ThemedView>
    );
  }

  const progress = summary.qualified_count % MILESTONE;

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      {headerOptions}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 20,
          paddingBottom: Math.max(80, insets.bottom + 60),
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
      >
        <ThemedText style={[styles.intro, { color: colors.secondaryText }]}>
          {SHARE_OFFER_COPY}.
        </ThemedText>

        {/* Invite code + share */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <ThemedText style={[styles.cardLabel, { color: colors.secondaryText }]}>
            Your Invite Code
          </ThemedText>
          <ThemedText style={[styles.code, { color: colors.text }]}>
            {summary.code}
          </ThemedText>
          <Pressable
            style={[styles.primaryButton, { backgroundColor: colors.link }]}
            onPress={handleShare}
          >
            <ThemedText style={styles.primaryButtonText}>Share Invite</ThemedText>
          </Pressable>
        </View>

        {/* Milestone progress */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <ThemedText style={[styles.progressText, { color: colors.text }]}>
            {progress} of {MILESTONE} qualified referrals
          </ThemedText>
          <ThemedText
            style={[styles.progressSub, { color: colors.secondaryText }]}
          >
            toward your next free month
          </ThemedText>
          <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: colors.success,
                  width: `${(progress / MILESTONE) * 100}%`,
                },
              ]}
            />
          </View>
          {summary.reward_months_available > 0 && (
            <ThemedText style={[styles.availableText, { color: colors.success }]}>
              {summary.reward_months_available} free{" "}
              {summary.reward_months_available === 1 ? "month" : "months"}{" "}
              available to claim below
            </ThemedText>
          )}
        </View>

        {/* Pending / qualifying breakdown */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.statRow}>
            <View style={styles.statText}>
              <ThemedText style={[styles.statLabel, { color: colors.text }]}>
                Pending
              </ThemedText>
              <ThemedText
                style={[styles.statDescription, { color: colors.secondaryText }]}
              >
                Friend signed up but hasn&apos;t paid yet
              </ThemedText>
            </View>
            <ThemedText style={[styles.statValue, { color: colors.text }]}>
              {summary.pending_count}
            </ThemedText>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.statRow}>
            <View style={styles.statText}>
              <ThemedText style={[styles.statLabel, { color: colors.text }]}>
                Qualifying
              </ThemedText>
              <ThemedText
                style={[styles.statDescription, { color: colors.secondaryText }]}
              >
                Friend paid — inside the 30-day window
              </ThemedText>
            </View>
            <ThemedText style={[styles.statValue, { color: colors.text }]}>
              {summary.qualifying_count}
            </ThemedText>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.statRow}>
            <View style={styles.statText}>
              <ThemedText style={[styles.statLabel, { color: colors.text }]}>
                Qualified
              </ThemedText>
              <ThemedText
                style={[styles.statDescription, { color: colors.secondaryText }]}
              >
                Counts toward your free months
              </ThemedText>
            </View>
            <ThemedText style={[styles.statValue, { color: colors.text }]}>
              {summary.qualified_count}
            </ThemedText>
          </View>
        </View>

        {/* Rewards list */}
        <ThemedText style={[styles.sectionTitle, { color: colors.secondaryText }]}>
          Rewards
        </ThemedText>
        {summary.rewards.length === 0 ? (
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <ThemedText
              style={[styles.emptyText, { color: colors.secondaryText }]}
            >
              No rewards yet. Invite 5 friends who subscribe to earn your first
              free month.
            </ThemedText>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            {summary.rewards.map((reward, index) => {
              const earnedDate = formatEarnedDate(reward.earned_at);
              // Scheduled = a recent Apple offer is outstanding (persisted by
              // the backend, survives restart) or a just-completed local claim
              // (bridge until the refetch lands).
              const isScheduled =
                scheduledIds.has(reward.id) ||
                isIosOfferOutstanding(reward.ios_offer_issued_at);
              // A scheduled reward whose status hasn't flipped yet is no longer
              // claimable, even though the backend still reports "earned".
              const isClaimable = reward.status === "earned" && !isScheduled;
              const isClaiming = claimingId === reward.id;
              const statusLabel = isScheduled
                ? "Free month scheduled — may take a few minutes to reflect"
                : REWARD_STATUS_LABEL[reward.status];
              const statusColor =
                isClaimable || isScheduled
                  ? colors.success
                  : colors.secondaryText;
              return (
                <View key={reward.id}>
                  {index > 0 && (
                    <View
                      style={[styles.divider, { backgroundColor: colors.border }]}
                    />
                  )}
                  <View style={styles.rewardRow}>
                    <View style={styles.rewardText}>
                      <ThemedText
                        style={[styles.rewardTitle, { color: colors.text }]}
                      >
                        1 month free
                      </ThemedText>
                      <ThemedText
                        style={[styles.rewardStatus, { color: statusColor }]}
                      >
                        {statusLabel}
                        {earnedDate && !isScheduled
                          ? ` · Earned ${earnedDate}`
                          : ""}
                      </ThemedText>
                    </View>
                    {isClaimable && (
                      <Pressable
                        disabled={isClaiming}
                        style={[
                          styles.claimButton,
                          { backgroundColor: colors.link },
                          isClaiming && styles.disabledButton,
                        ]}
                        onPress={() => confirmAndClaim(reward)}
                      >
                        {isClaiming ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <ThemedText style={styles.claimButtonText}>
                            Claim free month
                          </ThemedText>
                        )}
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
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
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  errorText: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 16,
  },
  intro: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 20,
    lineHeight: 22,
  },
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  cardLabel: {
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  code: {
    fontSize: 30,
    fontWeight: "700",
    letterSpacing: 2,
    marginBottom: 16,
  },
  primaryButton: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
  progressText: {
    fontSize: 20,
    fontWeight: "700",
  },
  progressSub: {
    fontSize: 14,
    marginTop: 2,
    marginBottom: 12,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
  },
  progressFill: {
    height: 8,
    borderRadius: 4,
  },
  availableText: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: 12,
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  statText: {
    flex: 1,
    marginRight: 12,
  },
  statLabel: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
  },
  statDescription: {
    fontSize: 13,
  },
  statValue: {
    fontSize: 22,
    fontWeight: "700",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  sectionTitle: {
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  emptyText: {
    fontSize: 15,
    lineHeight: 21,
  },
  rewardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
  },
  rewardText: {
    flex: 1,
    marginRight: 12,
  },
  rewardTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
  },
  rewardStatus: {
    fontSize: 13,
  },
  claimButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 130,
    alignItems: "center",
  },
  claimButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
  disabledButton: {
    opacity: 0.6,
  },
});
