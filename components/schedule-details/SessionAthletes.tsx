import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { LiftResult, SupabaseBests } from "@/data/types/athletes";
import { MeetName } from "@/data/types/meet";
import { useAppColors } from "@/hooks/useAppColors";
import { getAthleteLiftingResults } from "@/lib/database/offline-store";
import { supabase } from "@/lib/supabase";
import { useAuthGuard } from "@/utils/authGuard";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

// Type for just the athlete data we need
type SessionAthlete = {
  name: string;
  age: number;
  club: string;
  entryTotal: number;
  weightClass: string;
};

async function getSessionAthletes(
  sessionNumber: number,
  platform: string,
  meetId: MeetName,
) {
  try {
    // Fetch session-scoped athletes from Supabase.
    const { data, error } = await supabase
      .from("athletes")
      .select(
        "member_id,name,age,club,gender,weight_class,entry_total,adaptive",
      )
      .eq("session_number", sessionNumber)
      .eq("session_platform", platform)
      .eq("meet", meetId);

    if (error) {
      console.error("Error fetching athletes:", error);
      return {};
    }

    // If no athletes found for this meet/session/platform, return empty
    if (!data || data.length === 0) {
      return {};
    }

    // Transform and sort the data
    const athletes = data.map(
      (athlete) =>
        ({
          memberId: athlete.member_id || "",
          name: athlete.name,
          age: athlete.age,
          club: athlete.club,
          gender: athlete.gender || "",
          weightClass: athlete.weight_class || "",
          entryTotal: athlete.entry_total,
          adaptive: athlete.adaptive || false,
          session: {
            number: sessionNumber,
            platform: platform,
          },
        }) as LiftResult,
    );

    // Sort athletes by entry total
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
  } catch (error) {
    console.error("Error in getSessionAthletes:", error);
    return {};
  }
}

async function getAthleteBestsBatch(
  names: string[],
  meetId: MeetName,
): Promise<Record<string, SupabaseBests>> {
  const uniqueNames = Array.from(new Set(names.filter(Boolean)));
  const bestsByName: Record<string, SupabaseBests> = {};

  uniqueNames.forEach((name) => {
    bestsByName[name] = { snatch_best: 0, cj_best: 0, total: 0 };
  });

  if (uniqueNames.length === 0) {
    return bestsByName;
  }

  try {
    const { data, error } = await supabase
      .from("lifting_results")
      .select("name,snatch_best,cj_best,total")
      .in("name", uniqueNames);

    if (error) {
      throw error;
    }

    (data || []).forEach((record) => {
      if (!record.name) return;
      const current = bestsByName[record.name] || {
        snatch_best: 0,
        cj_best: 0,
        total: 0,
      };
      bestsByName[record.name] = {
        snatch_best: Math.max(
          current.snatch_best ?? 0,
          record.snatch_best ?? 0,
        ),
        cj_best: Math.max(current.cj_best ?? 0, record.cj_best ?? 0),
        total: Math.max(current.total ?? 0, record.total ?? 0),
      };
    });

    return bestsByName;
  } catch {
    // Fall back to locally cached lifting results when network fetch fails.
    await Promise.all(
      uniqueNames.map(async (name) => {
        try {
          const cachedResults = await getAthleteLiftingResults(meetId, name);
          if (!cachedResults || cachedResults.length === 0) return;

          let snatchBest = 0;
          let cjBest = 0;
          let totalBest = 0;
          cachedResults.forEach((row: any) => {
            snatchBest = Math.max(snatchBest, row?.snatch_best ?? 0);
            cjBest = Math.max(cjBest, row?.cj_best ?? 0);
            totalBest = Math.max(totalBest, row?.total ?? 0);
          });
          bestsByName[name] = {
            snatch_best: snatchBest,
            cj_best: cjBest,
            total: totalBest,
          };
        } catch {
          // Keep default zeros for this athlete.
        }
      }),
    );

    return bestsByName;
  }
}

export default function SessionAthletes({
  sessionNumber,
  platform,
  sessionWeightClass,
  refreshKey,
}: {
  sessionNumber: number;
  platform: string;
  sessionWeightClass: string;
  refreshKey: number;
}) {
  type SortKey = "entryTotal" | "snatch" | "cj" | "total";
  type SortDirection = "asc" | "desc";

  const router = useRouter();
  const colors = useAppColors();
  const { selectedMeet } = useSelectedMeet();
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
      const sessionAthletes = await getSessionAthletes(
        sessionNumber,
        platform,
        selectedMeet || "",
      );
      setAthletes(sessionAthletes);

      // Initialize loading states for each athlete
      const newLoadingBests: Record<string, boolean> = {};
      const athleteNames: string[] = [];
      for (const [, platformAthletes] of Object.entries(sessionAthletes)) {
        for (const athlete of platformAthletes) {
          newLoadingBests[athlete.name] = true;
          athleteNames.push(athlete.name);
        }
      }
      setLoadingBests(newLoadingBests);

      if (athleteNames.length > 0) {
        const bestsMap = await getAthleteBestsBatch(
          athleteNames,
          selectedMeet || "",
        );
        setAthleteBests((prev) => ({ ...prev, ...bestsMap }));
        setLoadingBests((prev) => {
          const next = { ...prev };
          athleteNames.forEach((name) => {
            next[name] = false;
          });
          return next;
        });
      }
    } catch (error) {
      console.error("Error loading athletes:", error);
      setAthletes({});
    } finally {
      setLoading(false);
    }
  }, [sessionNumber, platform, selectedMeet]);

  // Get time zone abbreviation
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
        key: "entryTotal",
        direction: "desc" as SortDirection,
      },
      {
        label: "Entry Total (Low to High)",
        key: "entryTotal",
        direction: "asc" as SortDirection,
      },
      {
        label: "Best Snatch (High to Low)",
        key: "snatch",
        direction: "desc" as SortDirection,
      },
      {
        label: "Best Snatch (Low to High)",
        key: "snatch",
        direction: "asc" as SortDirection,
      },
      {
        label: "Best CJ (High to Low)",
        key: "cj",
        direction: "desc" as SortDirection,
      },
      {
        label: "Best CJ (Low to High)",
        key: "cj",
        direction: "asc" as SortDirection,
      },
      {
        label: "Best Total (High to Low)",
        key: "total",
        direction: "desc" as SortDirection,
      },
      {
        label: "Best Total (Low to High)",
        key: "total",
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
        <View style={styles.athletesContainer}>
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
    <View style={styles.athletesContainer}>
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

        {Object.entries(sortedAthletes).map(([platform, platformAthletes]) => (
          <View key={platform}>
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
                            {athleteBests[athlete.name]?.snatch_best ?? "—"}
                            kg
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
                            {athleteBests[athlete.name]?.cj_best ?? "—"}
                            kg
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
                            {athleteBests[athlete.name]?.total ?? "—"}
                            kg
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
                    if (isSubscribed) {
                      router.push({
                        pathname: "/shared-screens/athlete-results",
                        params: { name: athlete.name },
                      });
                    } else {
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
  athletesContainer: {
    marginTop: 16,
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
