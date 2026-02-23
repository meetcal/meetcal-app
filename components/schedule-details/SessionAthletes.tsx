import { getAthleteBestsBatch } from "@/components/schedule-details/athleteBests";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { LiftResult, SupabaseBests } from "@/data/types/athletes";
import { MeetName } from "@/data/types/meet";
import { useAppColors } from "@/hooks/useAppColors";
import {
    getSessionAthletesFromMeetCache,
    saveMeetAthletes,
} from "@/lib/database/offline-store";
import { fetchAthletesWithSession } from "@/lib/database/queries";
import { isNetworkAvailable } from "@/lib/networkUtils";
import { SessionAthlete } from "@/types/schedule-details";
import { useAuthGuard } from "@/utils/authGuard";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Modal,
    Pressable,
    StyleSheet,
    View
} from "react-native";

function normalizePlatformKey(value: string) {
  return value.trim().toLowerCase();
}

function toSessionAthletesByPlatform(
  platform: string,
  athletes: LiftResult[],
): Record<string, SessionAthlete[]> {
  const sortedAthletes = [...athletes].sort(
    (a, b) => (b.entryTotal || 0) - (a.entryTotal || 0),
  );

  return {
    [platform]: sortedAthletes.map((athlete) => ({
      name: athlete.name,
      age: athlete.age,
      club: athlete.club,
      entryTotal: athlete.entryTotal,
      weightClass: athlete.weightClass,
    })),
  };
}

function filterSessionAthletes(
  athletes: LiftResult[],
  sessionNumber: number,
  platform: string,
) {
  const normalizedPlatform = normalizePlatformKey(platform);
  return athletes.filter((athlete) => {
    const athleteSession = athlete.session;
    if (!athleteSession) return false;
    if (athleteSession.number !== sessionNumber) return false;
    return normalizePlatformKey(athleteSession.platform) === normalizedPlatform;
  });
}

export default function SessionAthletes({
  sessionNumber,
  platform,
  sessionWeightClass,
  meetId,
  refreshKey,
}: {
  sessionNumber: number;
  platform: string;
  sessionWeightClass: string;
  meetId: MeetName;
  refreshKey: number;
}) {
  type SortKey = "entryTotal" | "snatch" | "cj" | "total";
  type SortDirection = "asc" | "desc";

  const router = useRouter();
  const colors = useAppColors();
  const [athleteBests, setAthleteBests] = useState<
    Record<string, SupabaseBests>
  >({});
  const [loading, setLoading] = useState(true);
  const [athletes, setAthletes] = useState<Record<string, SessionAthlete[]>>(
    {},
  );
  const [loadingBests, setLoadingBests] = useState<Record<string, boolean>>({});
  const [sortKey, setSortKey] = useState<SortKey>("entryTotal");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [sortModalVisible, setSortModalVisible] = useState(false);
  const { isSubscribed } = useSubscription();
  const { requireAuth } = useAuthGuard();

  const loadAthletes = useCallback(async () => {
    setLoading(true);
    
    try {
      if (!meetId) {
        setAthletes({});
        setAthleteBests({});
        setLoadingBests({});
        return;
      }

      const applySessionAthletes = async (
        nextAthletes: LiftResult[],
        isRefresh = false,
      ) => {
        const mapped = toSessionAthletesByPlatform(platform, nextAthletes);
        setAthletes(mapped);

        const athleteNames = nextAthletes.map((athlete) => athlete.name);
        if (!isRefresh) {
          const loadingState = athleteNames.reduce<Record<string, boolean>>(
            (acc, name) => {
              acc[name] = true;
              return acc;
            },
            {},
          );
          setLoadingBests(loadingState);
        } else {
          const newNamesSetToTrue = athleteNames.reduce<Record<string, boolean>>(
            (acc, name) => {
              acc[name] = true;
              return acc;
            },
            {},
          );
          setLoadingBests((prev) => ({ ...prev, ...newNamesSetToTrue }));
        }

        if (athleteNames.length === 0) {
          setAthleteBests({});
          setLoadingBests({});
          return;
        }

        const bestsMap = await getAthleteBestsBatch(athleteNames, meetId);
        setAthleteBests(bestsMap);
        setLoadingBests((prev) => {
          const next = { ...prev };
          athleteNames.forEach((name) => {
            next[name] = false;
          });
          return next;
        });
      };

      const cachedAthletes = await getSessionAthletesFromMeetCache(
        meetId,
        sessionNumber,
        platform,
      );
      

      if (cachedAthletes.length > 0) {
        await applySessionAthletes(cachedAthletes);
      } else {
        setAthletes({});
        setAthleteBests({});
        setLoadingBests({});
      }

      const hasNetwork = await isNetworkAvailable();
      if (!hasNetwork) {
        return;
      }

      const freshMeetAthletes = await fetchAthletesWithSession(meetId);
      await saveMeetAthletes(meetId, freshMeetAthletes);
      const freshSessionAthletes = filterSessionAthletes(
        freshMeetAthletes,
        sessionNumber,
        platform,
      );
      await applySessionAthletes(freshSessionAthletes, true);
    } catch (error) {
      console.error("Error loading athletes:", error);
      if (!meetId) {
        setAthletes({});
        setAthleteBests({});
        setLoadingBests({});
      }
    } finally {
      setLoading(false);
    }
  }, [sessionNumber, platform, meetId]);

  // Compute the numeric sort value for an athlete based on the active sort key
  const getSortValue = useCallback(
    (athlete: SessionAthlete) => {
      if (sortKey === "entryTotal") {
        return athlete.entryTotal || 0;
      }
      const bests = athleteBests[athlete.name];
      const fallback = athlete.entryTotal ?? 0;
      if (sortKey === "snatch") {
        return bests?.snatch_best ?? fallback;
      }
      if (sortKey === "cj") {
        return bests?.cj_best ?? fallback;
      }
      return bests?.total ?? fallback;
    },
    [athleteBests, sortKey],
  );

  const sortedAthletes = useMemo(() => {
    const entries = Object.entries(athletes).map(
      ([platformName, platformAthletes]) => {
        const sorted = [...platformAthletes].sort((a, b) => {
          const aValue = getSortValue(a);
          const bValue = getSortValue(b);
          if (aValue === bValue) return 0;
          return sortDirection === "desc" ? bValue - aValue : aValue - bValue;
        });
        return [platformName, sorted] as const;
      },
    );
    return Object.fromEntries(entries);
  }, [athletes, getSortValue, sortDirection]);

  const sortOptions = useMemo(
    () => [
      {
        label: "Entry Total (High to Low)",
        key: "entryTotal" as SortKey,
        direction: "desc" as SortDirection,
      },
      {
        label: "Entry Total (Low to High)",
        key: "entryTotal" as SortKey,
        direction: "asc" as SortDirection,
      },
      {
        label: "Best Snatch (High to Low)",
        key: "snatch" as SortKey,
        direction: "desc" as SortDirection,
      },
      {
        label: "Best Snatch (Low to High)",
        key: "snatch" as SortKey,
        direction: "asc" as SortDirection,
      },
      {
        label: "Best CJ (High to Low)",
        key: "cj" as SortKey,
        direction: "desc" as SortDirection,
      },
      {
        label: "Best CJ (Low to High)",
        key: "cj" as SortKey,
        direction: "asc" as SortDirection,
      },
      {
        label: "Best Total (High to Low)",
        key: "total" as SortKey,
        direction: "desc" as SortDirection,
      },
      {
        label: "Best Total (Low to High)",
        key: "total" as SortKey,
        direction: "asc" as SortDirection,
      },
    ],
    [],
  );

  const sortLabel = useMemo(() => {
    if (sortKey === "entryTotal") return "Entry Total";
    if (sortKey === "snatch") return "Best Snatch";
    if (sortKey === "cj") return "Best CJ";
    return "Best Total";
  }, [sortKey]);

  const handleSortPress = useCallback(() => {
    setSortModalVisible(true);
  }, []);

  const handleSortSelect = useCallback(
    (key: SortKey, direction: SortDirection) => {
      setSortKey(key);
      setSortDirection(direction);
      setSortModalVisible(false);
    },
    [],
  );

   
  useEffect(() => {
    loadAthletes();
  }, [loadAthletes, refreshKey]);

  if (!athletes[platform]?.length) {
    if (loading) {
      return (
        <View>
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <View
              style={[
                styles.titleSection,
                { borderBottomColor: colors.border },
              ]}
            >
              <View style={styles.titleRow}>
                <ThemedText style={styles.athletesTitle}>
                  Session Athletes
                </ThemedText>
                <Pressable
                  style={({ pressed }) => [
                    styles.sortButton,
                    pressed && isSubscribed && { opacity: 0.8 },
                  ]}
                  onPress={
                    isSubscribed
                      ? handleSortPress
                      : () => {
                          const authResult = requireAuth({
                            feature: "sort-athletes",
                            message: "Sign in to access premium features.",
                            returnPath: "/shared-screens/schedule-details",
                          });
                          if (authResult === null || authResult === false) {
                            return;
                          }
                          router.push({
                            pathname: "/shared-screens/paywall",
                            params: {
                              from: "/shared-screens/schedule-details",
                              feature: "sort-athletes",
                            },
                          } as any);
                        }
                  }
                >
                  <IconSymbol
                    name={isSubscribed ? "arrow.up.arrow.down" : "lock"}
                    size={18}
                    color={isSubscribed ? colors.text : colors.secondaryText}
                  />
                  <ThemedText
                    style={[
                      styles.sortLabel,
                      {
                        color: isSubscribed
                          ? colors.text
                          : colors.secondaryText,
                      },
                    ]}
                  >
                    {sortLabel}
                  </ThemedText>
                </Pressable>
              </View>
            </View>
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.secondaryText} />
              <ThemedText
                style={[styles.loadingText, { color: colors.secondaryText }]}
              >
                Loading athletes...
              </ThemedText>
            </View>
          </View>
        </View>
      );
    }
    return null;
  }

  return (
    <View>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <View
          style={[styles.titleSection, { borderBottomColor: colors.border }]}
        >
          <View style={styles.titleRow}>
            <ThemedText style={styles.athletesTitle}>
              Session Athletes
            </ThemedText>
            <Pressable
              style={({ pressed }) => [
                styles.sortButton,
                pressed && isSubscribed && { opacity: 0.8 },
              ]}
              onPress={
                isSubscribed
                  ? handleSortPress
                  : () => {
                      const authResult = requireAuth({
                        feature: "sort-athletes",
                        message: "Sign in to access premium features.",
                        returnPath: "/shared-screens/schedule-details",
                      });
                      if (authResult === null || authResult === false) {
                        return;
                      }
                      router.push({
                        pathname: "/shared-screens/paywall",
                        params: {
                          from: "/shared-screens/schedule-details",
                          feature: "sort-athletes",
                        },
                      } as any);
                    }
              }
            >
              <IconSymbol
                name={isSubscribed ? "arrow.up.arrow.down" : "lock"}
                size={18}
                color={isSubscribed ? colors.text : colors.secondaryText}
              />
              <ThemedText
                style={[
                  styles.sortLabel,
                  { color: isSubscribed ? colors.text : colors.secondaryText },
                ]}
              >
                {sortLabel}
              </ThemedText>
            </Pressable>
          </View>
        </View>

        {Object.entries(sortedAthletes).map(([platformKey, platformAthletes]) => (
          <View key={platformKey}>
            {platformAthletes.map((athlete, index) => (
              <View
                key={athlete.name}
                style={[
                  styles.athleteSection,
                  index !== platformAthletes.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                <View style={styles.athleteHeader}>
                  <ThemedText style={styles.athleteName}>
                    {athlete.name}
                  </ThemedText>
                </View>
                <ThemedText
                  style={[
                    styles.athleteDetail,
                    { color: colors.secondaryText },
                  ]}
                >
                  Age: 
{' '}
{athlete.age}
{' '}
| Weight Class: 
{' '}
{athlete.weightClass}
                </ThemedText>
                <ThemedText
                  style={[
                    styles.athleteDetail,
                    { color: colors.secondaryText },
                  ]}
                >
                  {athlete.club}
                </ThemedText>

                <View style={styles.statsRow}>
                  <View style={styles.statItem}>
                    <ThemedText
                      style={[
                        styles.statLabel,
                        { color: colors.secondaryText },
                      ]}
                    >
                      Entry Total
                    </ThemedText>
                    <ThemedText style={styles.statValue}>
                      {athlete.entryTotal}
                      kg
                    </ThemedText>
                  </View>
                  {isSubscribed ? (
                    loadingBests[athlete.name] ? (
                      <ActivityIndicator
                        size="small"
                        color={colors.secondaryText}
                      />
                    ) : (
                      <>
                        <View style={styles.statItem}>
                          <ThemedText
                            style={[
                              styles.statLabel,
                              { color: colors.secondaryText },
                            ]}
                          >
                            Best Sn
                          </ThemedText>
                          <ThemedText style={styles.statValue}>
                            {athleteBests[athlete.name]?.snatch_best == null
                              ? "—"
                              : `${athleteBests[athlete.name]?.snatch_best}kg`}
                          </ThemedText>
                        </View>
                        <View style={styles.statItem}>
                          <ThemedText
                            style={[
                              styles.statLabel,
                              { color: colors.secondaryText },
                            ]}
                          >
                            Best CJ
                          </ThemedText>
                          <ThemedText style={styles.statValue}>
                            {athleteBests[athlete.name]?.cj_best == null
                              ? "—"
                              : `${athleteBests[athlete.name]?.cj_best}kg`}
                          </ThemedText>
                        </View>
                        <View style={styles.statItem}>
                          <ThemedText
                            style={[
                              styles.statLabel,
                              { color: colors.secondaryText },
                            ]}
                          >
                            Best Total
                          </ThemedText>
                          <ThemedText style={styles.statValue}>
                            {athleteBests[athlete.name]?.total == null
                              ? "—"
                              : `${athleteBests[athlete.name]?.total}kg`}
                          </ThemedText>
                        </View>
                      </>
                    )
                  ) : (
                    <Pressable
                      style={({ pressed }) => [
                        styles.premiumStatsContainer,
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() => {
                        const authResult = requireAuth({
                          feature: "athlete-bests",
                          message: "Sign in to access premium features.",
                          returnPath: "/shared-screens/schedule-details",
                        });
                        if (authResult === null || authResult === false) {
                          return;
                        }
                        router.push({
                          pathname: "/shared-screens/paywall",
                          params: {
                            from: "/shared-screens/schedule-details",
                            feature: "athlete-bests",
                          },
                        } as any);
                      }}
                    >
                      <View style={styles.premiumLabelsRow}>
                        <ThemedText
                          style={[
                            styles.statLabel,
                            styles.premiumStatLabel,
                            { color: colors.secondaryText },
                          ]}
                        >
                          Best Sn
                        </ThemedText>
                        <ThemedText
                          style={[
                            styles.statLabel,
                            styles.premiumStatLabel,
                            { color: colors.secondaryText },
                          ]}
                        >
                          Best CJ
                        </ThemedText>
                        <ThemedText
                          style={[
                            styles.statLabel,
                            styles.premiumStatLabel,
                            { color: colors.secondaryText },
                          ]}
                        >
                          Best Total
                        </ThemedText>
                      </View>
                      <View style={styles.premiumUnlockBadge}>
                        <IconSymbol name="lock" size={11} color="#FFFFFF" />
                        <ThemedText style={styles.premiumUnlockText}>
                          Unlock with Premium
                        </ThemedText>
                        <IconSymbol
                          name="chevron.right"
                          size={11}
                          color="#FFFFFF"
                        />
                      </View>
                    </Pressable>
                  )}
                </View>

                <Pressable
                  style={({ pressed }) => [
                    styles.meetResultsButton,
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() => {
                    const authResult = requireAuth({
                      feature: "athlete-results",
                      message: "Sign in to access premium features.",
                      returnPath: "/shared-screens/schedule-details",
                    });
                    if (authResult === null || authResult === false) {
                      return;
                    }
                    if (isSubscribed === true) {
                      router.push({
                        pathname: "/shared-screens/athlete-results",
                        params: { name: athlete.name, meet: meetId },
                      });
                    } else if (isSubscribed === false) {
                      router.push({
                        pathname: "/shared-screens/paywall",
                        params: {
                          from: "/shared-screens/schedule-details",
                          feature: "athlete-results",
                        },
                      } as any);
                    }
                  }}
                >
                  <ThemedText style={styles.meetResultsText}>
                    See All Meet Results
                  </ThemedText>
                  <IconSymbol
                    name="chevron.right"
                    size={13}
                    color={colors.link}
                  />
                </Pressable>
              </View>
            ))}
          </View>
        ))}
      </View>
      <Modal
        visible={sortModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSortModalVisible(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setSortModalVisible(false)}
        >
          <Pressable
            style={[styles.modalCard, { backgroundColor: colors.card }]}
          >
            <ThemedText style={[styles.modalTitle, { color: colors.text }]}>
              Sort Athletes
            </ThemedText>
            {sortOptions.map((option) => {
              const isSelected =
                option.key === sortKey && option.direction === sortDirection;
              return (
                <Pressable
                  key={`${option.key}-${option.direction}`}
                  style={({ pressed }) => [
                    styles.modalOption,
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => handleSortSelect(option.key, option.direction)}
                >
                  <ThemedText
                    style={[styles.modalOptionText, { color: colors.text }]}
                  >
                    {option.label}
                  </ThemedText>
                  {isSelected ? (
                    <IconSymbol
                      name="checkmark"
                      size={16}
                      color={colors.link}
                    />
                  ) : null}
                </Pressable>
              );
            })}
            <Pressable
              style={({ pressed }) => [
                styles.modalCancel,
                pressed && { opacity: 0.7 },
              ]}
              onPress={() => setSortModalVisible(false)}
            >
              <ThemedText
                style={[
                  styles.modalCancelText,
                  { color: colors.secondaryText },
                ]}
              >
                Cancel
              </ThemedText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    marginBottom: 16,
    overflow: "hidden",
  },
  athletesTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  titleSection: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sortButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  sortLabel: {
    fontSize: 13,
    fontWeight: "500",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  modalCard: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "600",
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  modalOptionText: {
    fontSize: 15,
    fontWeight: "500",
  },
  modalCancel: {
    marginTop: 8,
    alignItems: "center",
    paddingVertical: 8,
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: "600",
  },
  athleteSection: {
    padding: 16,
  },
  athleteHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  athleteName: {
    fontSize: 17,
    fontWeight: "600",
  },
  athleteDetail: {
    fontSize: 15,
    marginBottom: 2,
  },
  statsRow: {
    flexDirection: "row",
    marginTop: 8,
    gap: 16,
  },
  statItem: {
    flex: 1,
  },
  statLabel: {
    fontSize: 13,
    marginBottom: 2,
  },
  statValue: {
    fontSize: 15,
    fontWeight: "500",
  },
  meetResultsButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
  },
  meetResultsText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#007AFF",
  },
  loadingContainer: {
    padding: 32,
    alignItems: "center",
    gap: 16,
  },
  loadingText: {
    fontSize: 15,
  },
  premiumStatsContainer: {
    flex: 3,
    flexDirection: "column",
    gap: 2,
  },
  premiumLabelsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  premiumStatLabel: {
    flex: 1,
    textAlign: "center",
  },
  premiumUnlockBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#007AFF",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginTop: 4,
  },
  premiumUnlockText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },
});
