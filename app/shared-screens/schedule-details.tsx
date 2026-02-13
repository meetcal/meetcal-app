import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { getPlatformColors } from "@/constants/Colors";
import { useSavedSessions } from "@/contexts/SavedSessionsContext";
import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useTheme } from "@/contexts/ThemeContext";
import {
  convertToUTC,
  formatTimeWithZone,
  getMeetConfig,
  getMeetVenueLocation,
} from "@/data/meets/config";
import { LiftResult, Platform as PlatformType } from "@/data/types/athletes";
import { MeetName } from "@/data/types/meet";
import {
  getAthleteLiftingResults,
  getMeetData,
} from "@/lib/database/offline-store";
import { supabase } from "@/lib/supabase";
import {
  DaySchedule,
  Platform as PlatformDetails,
  Schedule,
} from "@/types/schedule";
import { useAuthGuard } from "@/utils/authGuard";
import { useUser } from "@clerk/clerk-expo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Calendar from "expo-calendar";
import * as Haptics from "expo-haptics";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as StoreReview from "expo-store-review";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

// Update interface names
interface SessionPlatformDetails {
  platform: string;
  platformStartTime?: string;
  weightClass?: string;
}

interface Session {
  number: number;
  platforms: SessionPlatformDetails[];
}

interface ScheduleDay {
  date: string;
  fullDate: string;
  sessions: Session[];
}

// Add interface for Supabase results
interface SupabaseBests {
  snatch_best: number | null;
  cj_best: number | null;
  total: number | null;
}

// Add interface for saved warmups
interface SavedWarmup {
  id: string;
  name: string;
  lastModified: string;
  athlete: {
    name: string;
    club: string;
    snatchPR: number;
    cleanAndJerkPR: number;
  };
  warmupRows: {
    minutesOut: string | number;
    snatch: string | number;
    cleanAndJerk: string | number;
  }[];
  meet: string;
}

// Type for just the athlete data we need
type SessionAthlete = {
  name: string;
  age: number;
  club: string;
  entryTotal: number;
  weightClass: string;
};

// Extended type for athlete data from sync manager
interface CachedAthlete extends SessionAthlete {
  sessionNumber: number;
  platformName: string;
}

// Function to get user-specific storage key
const getSavedWarmupsKey = (userId: string) => `@saved_warmups_${userId}`;

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
  } catch (error) {
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

function SessionAthletes({
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

  const { user } = useUser();
  const router = useRouter();
  const { currentTheme } = useTheme();
  const { selectedMeet, meetDetails } = useSelectedMeet();
  const [athleteBests, setAthleteBests] = useState<
    Record<string, SupabaseBests>
  >({});
  const [loading, setLoading] = useState(true);
  const [athletes, setAthletes] = useState<Record<string, SessionAthlete[]>>(
    {},
  );
  const [athleteWarmups, setAthleteWarmups] = useState<Record<string, boolean>>(
    {},
  );
  const [loadingBests, setLoadingBests] = useState<Record<string, boolean>>({});
  const [sortKey, setSortKey] = useState<SortKey>("entryTotal");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [sortModalVisible, setSortModalVisible] = useState(false);
  const { isSubscribed } = useSubscription();
  const { requireAuth } = useAuthGuard();

  const loadAthletes = async () => {
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
      for (const [_, platformAthletes] of Object.entries(sessionAthletes)) {
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

      // Check for warmups after loading athletes
      await checkForWarmups();
    } catch (error) {
      console.error("Error loading athletes:", error);
      setAthletes({});
    } finally {
      setLoading(false);
    }
  };

  // Get time zone abbreviation
  const timeZoneAbbr = useMemo(() => {
    const timeZoneId = meetDetails?.time.timeZoneIdentifier || "America/Denver";
    const date = new Date();
    return (
      new Intl.DateTimeFormat("en-US", {
        timeZone: timeZoneId,
        timeZoneName: "short",
      })
        .formatToParts(date)
        .find((part) => part.type === "timeZoneName")?.value || ""
    );
  }, [meetDetails?.time.timeZoneIdentifier]);

  const colors = {
    border: currentTheme === "dark" ? "#38383A" : "#E1E1E1",
    text: currentTheme === "dark" ? "#FFFFFF" : "#000000",
    secondaryText: currentTheme === "dark" ? "#8E8E93" : "#6B6B6B",
    card: currentTheme === "dark" ? "#1C1C1E" : "#FFFFFF",
    link: "#007AFF",
  };

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

  // Check for saved warmups
  const checkForWarmups = async () => {
    if (!user?.id) return;

    try {
      const key = getSavedWarmupsKey(user.id);
      const savedWarmups = await AsyncStorage.getItem(key);
      if (savedWarmups) {
        const warmups = JSON.parse(savedWarmups);
        const warmupsByAthlete: Record<string, boolean> = {};

        // Check each athlete for warmups
        warmups.forEach((warmup: SavedWarmup) => {
          if (warmup.meet === selectedMeet) {
            warmupsByAthlete[warmup.athlete.name] = true;
          }
        });

        setAthleteWarmups(warmupsByAthlete);
      }
    } catch (error) {
      console.error("Error checking warmups:", error);
    }
  };

  useEffect(() => {
    loadAthletes();
  }, [sessionNumber, platform, refreshKey, selectedMeet]);

  const handleWarmupPress = async (athleteName: string) => {
    if (!user?.id) return;

    try {
      const key = getSavedWarmupsKey(user.id);
      const savedWarmups = await AsyncStorage.getItem(key);
      if (savedWarmups) {
        const warmups = JSON.parse(savedWarmups);
        const warmup = warmups.find(
          (w: SavedWarmup) =>
            w.athlete.name === athleteName && w.meet === selectedMeet,
        );
        if (warmup) {
          router.push({
            pathname: "/warmup-details",
            params: { id: warmup.id },
          });
        }
      }
    } catch (error) {
      console.error("Error loading warmup:", error);
    }
  };

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
                  {athleteWarmups[athlete.name] && (
                    <Pressable
                      style={({ pressed }) => [
                        styles.headerLink,
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() => handleWarmupPress(athlete.name)}
                    >
                      <ThemedText
                        style={[styles.linkText, { color: colors.link }]}
                      >
                        Warmups
                      </ThemedText>
                      <IconSymbol
                        name="chevron.right"
                        size={13}
                        color={colors.link}
                      />
                    </Pressable>
                  )}
                </View>
                <ThemedText
                  style={[
                    styles.athleteDetail,
                    { color: colors.secondaryText },
                  ]}
                >
                  Age: {athlete.age} | Weight Class: {athlete.weightClass}
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
                      {athlete.entryTotal}kg
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
                            {athleteBests[athlete.name]?.snatch_best ?? "—"}kg
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
                            {athleteBests[athlete.name]?.cj_best ?? "—"}kg
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
                            {athleteBests[athlete.name]?.total ?? "—"}kg
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
                        pathname: "/athlete-results",
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
                  <IconSymbol name="chevron.right" size={13} color="#007AFF" />
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

function PlatformBadge({ platform }: { platform: string }) {
  const platformColors = getPlatformColors();
  const backgroundColor = platformColors[platform as PlatformType] || "#808080";

  return (
    <View style={[styles.platformBadge, { backgroundColor }]}>
      <ThemedText style={styles.platformText}>{platform}</ThemedText>
    </View>
  );
}

// Add this helper function (or import it if you want to move it to a utilities file)
function calculateWeighInTime(startTime: string): string {
  const [time, period] = startTime.split(" ");
  const [hours, minutes] = time.split(":").map(Number);

  // Convert to 24 hour format
  let hour24 = hours;
  if (period === "PM" && hours !== 12) hour24 += 12;
  if (period === "AM" && hours === 12) hour24 = 0;

  // Subtract 2 hours
  let weighInHour = hour24 - 2;

  // Handle day wrap
  if (weighInHour < 0) weighInHour += 24;

  // Convert back to 12 hour format
  let weighInPeriod = "AM";
  if (weighInHour >= 12) {
    weighInPeriod = "PM";
    if (weighInHour > 12) weighInHour -= 12;
  }
  if (weighInHour === 0) weighInHour = 12;

  return `${weighInHour}:${minutes.toString().padStart(2, "0")} ${weighInPeriod}`;
}

const checkAndShowReviewPrompt = async () => {
  try {
    const hasShownReview = await AsyncStorage.getItem("hasShownReview");
    const hasSavedBefore = await AsyncStorage.getItem("hasSavedBefore");

    if (!hasSavedBefore && !hasShownReview) {
      // Mark that user has saved a session
      await AsyncStorage.setItem("hasSavedBefore", "true");
      // Use native store review prompt
      try {
        const isAvailable = await StoreReview.isAvailableAsync();
        if (isAvailable) {
          await StoreReview.requestReview();
        }
      } catch (error) {
        console.warn("ScheduleDetails: Store review unavailable", error);
      }
      await AsyncStorage.setItem("hasShownReview", "true");
    }
  } catch (error) {
    console.error("Error checking review status:", error);
  }
};

// Function to generate unique session IDs
function generateSessionId(
  meet: MeetName,
  sessionNumber: number | string,
  platform: string,
): string {
  return `${meet}-${sessionNumber}-${platform}`.replace(/\s+/g, "-");
}

export default function SessionDetailsScreen() {
  const [hasCalendarPermission, setHasCalendarPermission] = useState(false);
  const router = useRouter();
  const { saveSession, removeSession, isSessionSaved } = useSavedSessions();
  const { selectedMeet, meetDetails } = useSelectedMeet();
  const { isSubscribed } = useSubscription();
  const { requireAuth } = useAuthGuard();
  const [refreshing, setRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionData, setSessionData] = useState<Session | null>(null);
  const [currentSchedule, setCurrentSchedule] = useState<Schedule>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  // Get time zone abbreviation
  const timeZoneAbbr = useMemo(() => {
    const timeZoneId = meetDetails?.time.timeZoneIdentifier || "America/Denver";
    const date = new Date();
    return (
      new Intl.DateTimeFormat("en-US", {
        timeZone: timeZoneId,
        timeZoneName: "short",
      })
        .formatToParts(date)
        .find((part) => part.type === "timeZoneName")?.value || ""
    );
  }, [meetDetails?.time.timeZoneIdentifier]);

  const rawParams = useLocalSearchParams<{
    id?: string;
    sessionNumber?: string;
    platform?: string;
    weightClass?: string;
    startTime?: string;
    weighInTime?: string;
    date?: string;
    athleteName?: string;
    meet?: MeetName;
  }>();

  // Ensure required params have values
  const params = {
    id: rawParams.id || "",
    sessionNumber: rawParams.sessionNumber || "",
    platform: rawParams.platform || "",
    weightClass: rawParams.weightClass || "",
    startTime: rawParams.startTime || "",
    weighInTime: rawParams.weighInTime || "",
    date: rawParams.date || "",
    athleteName: rawParams.athleteName,
    meet: rawParams.meet || selectedMeet || "",
  };

  // Generate the correct session ID using the meet information
  const sessionId = useMemo(
    () => generateSessionId(params.meet, params.sessionNumber, params.platform),
    [params.meet, params.sessionNumber, params.platform],
  );

  const { currentTheme } = useTheme();
  const platformColors = getPlatformColors();

  // Use the generated sessionId instead of params.id
  const isSaved = isSessionSaved(sessionId);

  const colors = {
    background: currentTheme === "dark" ? "#000000" : "#F5F5F5",
    card: currentTheme === "dark" ? "#1C1C1E" : "#FFFFFF",
    border: currentTheme === "dark" ? "#38383A" : "#E1E1E1",
    text: currentTheme === "dark" ? "#FFFFFF" : "#000000",
    secondaryText: currentTheme === "dark" ? "#8E8E93" : "#6B6B6B",
  };

  useEffect(() => {
    (async () => {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      setHasCalendarPermission(status === "granted");
    })();
  }, []);

  // Load session data from cache
  const loadSessionData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Get cached data (context's SyncManager handles syncing)
      const meetData = await getMeetData(params.meet as MeetName);
      if (meetData.schedule) {
        setCurrentSchedule(meetData.schedule);

        // Find the session in the schedule
        const day = meetData.schedule.find((day: DaySchedule) =>
          day.sessions.some(
            (s: Session) => s.number === parseInt(params.sessionNumber),
          ),
        );

        const session = day?.sessions.find(
          (s: Session) => s.number === parseInt(params.sessionNumber),
        );

        if (session) {
          setSessionData(session);
        }
      }
    } catch (error) {
      console.error("Error loading session data:", error);
    } finally {
      setIsLoading(false);
    }
  }, [params.meet, params.sessionNumber]);

  // Initial load
  useEffect(() => {
    loadSessionData();
  }, [loadSessionData]);

  // Get the correct weight class from current schedule
  const sessionWeightClass = useMemo(() => {
    const sessionDay = currentSchedule.find((day: DaySchedule) =>
      day.sessions.some(
        (s: Session) => s.number === parseInt(params.sessionNumber),
      ),
    );

    const session = sessionDay?.sessions.find(
      (s: Session) => s.number === parseInt(params.sessionNumber),
    );

    const platformData = session?.platforms.find(
      (p: PlatformDetails) => p.platform === params.platform,
    );

    return platformData?.weightClass || params.weightClass;
  }, [
    currentSchedule,
    params.sessionNumber,
    params.platform,
    params.weightClass,
  ]);

  const sessionDate = useMemo(() => {
    const sessionDay = currentSchedule.find((day: DaySchedule) =>
      day.sessions.some(
        (s: Session) => s.number === parseInt(params.sessionNumber),
      ),
    );
    return sessionDay?.date || `Session ${params.sessionNumber}`;
  }, [currentSchedule, params.sessionNumber]);

  // Get the platform-specific start time and calculate weigh-in time
  const platformStartTime = useMemo(() => {
    const sessionDay = currentSchedule.find((day: DaySchedule) =>
      day.sessions.some(
        (s: Session) => s.number === parseInt(params.sessionNumber),
      ),
    );

    const session = sessionDay?.sessions.find(
      (s: Session) => s.number === parseInt(params.sessionNumber),
    );

    const platformData = session?.platforms.find(
      (p: PlatformDetails) => p.platform === params.platform,
    );

    return platformData?.platformStartTime || params.startTime;
  }, [
    currentSchedule,
    params.sessionNumber,
    params.platform,
    params.startTime,
  ]);

  // Calculate weigh-in time based on platform start time
  const platformWeighInTime = useMemo(() => {
    return calculateWeighInTime(platformStartTime);
  }, [platformStartTime]);

  const showSaveAlert = (action: "save" | "remove") => {
    const title = action === "save" ? "Session Saved" : "Session Unsaved";
    let message =
      action === "save"
        ? `Session ${params.sessionNumber} - ${params.platform} - ${sessionWeightClass} has been saved to your list`
        : `Session ${params.sessionNumber} - ${params.platform} - ${sessionWeightClass} has been unsaved from your list`;

    Alert.alert(title, message, [{ text: "OK" }], {
      userInterfaceStyle: "light",
    });
  };

  const handleSavePress = async () => {
    // Check authentication first
    const authResult = requireAuth({
      feature: "save-session",
      message: "Sign in to save sessions and sync them across your devices.",
      returnPath: "/shared-screens/schedule-details",
    });
    if (authResult === null || authResult === false) {
      return;
    }

    if (isSaved) {
      const removed = await removeSession(sessionId);
      if (!removed) {
        Alert.alert(
          "Error",
          "Failed to remove saved session. Please try again.",
        );
        return;
      }
      showSaveAlert("remove");
    } else {
      // Find the session day in the current schedule
      const sessionDay = currentSchedule.find((day: DaySchedule) =>
        day.sessions.some(
          (s: Session) => s.number === parseInt(params.sessionNumber),
        ),
      );

      if (!sessionDay) {
        console.error("Session day not found in schedule");
        return;
      }

      const saved = await saveSession({
        id: sessionId,
        sessionNumber: Number(params.sessionNumber),
        platform: params.platform,
        weightClass: sessionWeightClass || params.weightClass,
        startTime: platformStartTime,
        weighInTime: platformWeighInTime,
        date: sessionDay.fullDate,
        athleteNames: params.athleteName ? [params.athleteName] : undefined,
        meet: params.meet,
      });
      if (!saved) {
        Alert.alert("Error", "Failed to save session. Please try again.");
        return;
      }
      showSaveAlert("save");
      checkAndShowReviewPrompt();
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const showSuccessAlert = () => {
    Alert.alert(
      "Added to Calendar",
      `Session ${params.sessionNumber} - ${params.platform} - ${sessionWeightClass} has been added to your calendar`,
      [{ text: "OK" }],
      { userInterfaceStyle: "light" },
    );
  };

  const addToCalendar = async () => {
    if (!hasCalendarPermission) {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Calendar Permission Required",
          "Please enable calendar access in your device settings to add events.",
          [{ text: "OK" }],
          { userInterfaceStyle: "light" },
        );
        return;
      }
      setHasCalendarPermission(true);
    }

    // Find the session and get platform-specific time
    const sessionDay = currentSchedule.find((day: DaySchedule) =>
      day.sessions.some(
        (session: Session) =>
          session.number === parseInt(params.sessionNumber) &&
          session.platforms.some(
            (platform: SessionPlatformDetails) =>
              platform.platform === params.platform,
          ),
      ),
    );

    if (!sessionDay) {
      console.error("Session day not found:", {
        sessionNumber: params.sessionNumber,
        platform: params.platform,
        date: params.date,
      });
      Alert.alert(
        "Error",
        "Could not find session details. Please try again.",
        [{ text: "OK" }],
        { userInterfaceStyle: "light" },
      );
      return;
    }

    try {
      // Get meet config first
      const meetConfig = await getMeetConfig(params.meet);

      // Use platform-specific start time if available, otherwise use session start time
      const session = sessionDay.sessions.find(
        (s) => s.number === parseInt(params.sessionNumber),
      );
      const platform = session?.platforms.find(
        (p) => p.platform === params.platform,
      );
      const startTime = platform?.platformStartTime || params.startTime;
      const weighInTime = calculateWeighInTime(startTime);

      // Convert times to UTC using the meet's time zone
      const startDate = convertToUTC(
        startTime,
        sessionDay.fullDate,
        params.meet,
      );
      const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);

      const eventDetails = {
        title: `Session ${params.sessionNumber} - Platform ${params.platform}`,
        location: getMeetVenueLocation(params.meet),
        notes: `Weight Class: ${sessionWeightClass}\nWeigh-in Time: ${formatTimeWithZone(weighInTime, params.meet)}`,
        startDate: startDate,
        endDate: endDate,
        timeZone: meetConfig.time.timeZoneIdentifier,
        alarms: [
          {
            relativeOffset: -60,
          },
        ],
      };

      let calendarId;

      if (Platform.OS === "ios") {
        const calendar = await Calendar.getDefaultCalendarAsync();
        calendarId = calendar.id;
      } else {
        const calendars = await Calendar.getCalendarsAsync(
          Calendar.EntityTypes.EVENT,
        );
        const primaryCalendar = calendars.find(
          (cal) =>
            cal.accessLevel === Calendar.CalendarAccessLevel.OWNER &&
            cal.allowsModifications,
        );

        if (!primaryCalendar) {
          throw new Error("no_calendar");
        }

        calendarId = primaryCalendar.id;
      }

      await Calendar.createEventAsync(calendarId, eventDetails);
      showSuccessAlert();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error("Error creating calendar event:", error);

      const errorMessage = Platform.select({
        ios: "Could not add event to calendar. Please try again.",
        android:
          "Could not add event to calendar. Please make sure you have a calendar app installed and try again.",
        default: "Could not add event to calendar. Please try again.",
      });

      Alert.alert("Error", errorMessage, [{ text: "OK" }], {
        userInterfaceStyle: "light",
      });
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadSessionData();
      // Trigger athlete data refresh
      setRefreshKey((prev) => prev + 1);
    } catch (error) {
      console.error("Refresh failed:", error);
    } finally {
      setRefreshing(false);
    }
  }, [loadSessionData]);

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: sessionDate,
          headerBackTitle: "Back",
          gestureEnabled: true,
          gestureDirection: "horizontal",
          animation: "slide_from_right",
          headerStyle: {
            backgroundColor: colors.background,
          },
          headerShadowVisible: false,
        }}
      />

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: 16 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.text}
          />
        }
      >
        <View style={[styles.content, { backgroundColor: colors.background }]}>
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <View
              style={[styles.section, { borderBottomColor: colors.border }]}
            >
              <ThemedText
                style={[styles.sessionSummary, { color: colors.text }]}
              >
                Session {params.sessionNumber} • {platformStartTime}{" "}
                {timeZoneAbbr}
              </ThemedText>
            </View>

            <View
              style={[styles.section, { borderBottomColor: colors.border }]}
            >
              <View style={styles.platformWeightRow}>
                <PlatformBadge platform={params.platform} />
                <ThemedText
                  style={[styles.inlineValue, { color: colors.text }]}
                >
                  {sessionWeightClass}
                </ThemedText>
              </View>
            </View>

            <View style={styles.buttonContainer}>
              <Pressable
                style={({ pressed }) => [
                  styles.saveButton,
                  pressed && styles.saveButtonPressed,
                ]}
                onPress={handleSavePress}
              >
                <ThemedText style={styles.saveButtonText}>
                  {isSaved ? "Unsave Session" : "Save Session"}
                </ThemedText>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.calendarButton,
                  pressed && styles.calendarButtonPressed,
                ]}
                onPress={addToCalendar}
              >
                <ThemedText style={styles.calendarButtonText}>
                  Add to Calendar
                </ThemedText>
              </Pressable>
            </View>

            <View
              style={[
                styles.section,
                styles.lastSection,
                styles.sectionTopDivider,
                { borderTopColor: colors.border },
              ]}
            >
              <View style={styles.premiumButtonsRow}>
                <Pressable
                  style={({ pressed }) => [
                    styles.premiumButton,
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() => {
                    const authResult = requireAuth({
                      feature: "qualifying-totals",
                      message: "Sign in to access premium features.",
                      returnPath: "/shared-screens/schedule-details",
                    });
                    if (authResult === null || authResult === false) {
                      return;
                    }
                    if (isSubscribed) {
                      router.push({
                        pathname: "/comp-data/new-qualifying-totals",
                        params: {
                          sessionNumber: params.sessionNumber,
                          platform: params.platform,
                          meet: params.meet,
                        },
                      });
                    } else {
                      router.push({
                        pathname: "/shared-screens/paywall",
                        params: {
                          from: "/shared-screens/schedule-details",
                          feature: "qualifying-totals",
                        },
                      } as any);
                    }
                  }}
                >
                  <ThemedText
                    style={[styles.premiumButtonText, { color: colors.text }]}
                  >
                    Qualifying Totals
                  </ThemedText>
                  <IconSymbol name="chevron.right" size={13} color="#007AFF" />
                </Pressable>

                <View
                  style={[
                    styles.verticalDivider,
                    { backgroundColor: colors.border },
                  ]}
                />

                <Pressable
                  style={({ pressed }) => [
                    styles.premiumButton,
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() => {
                    const authResult = requireAuth({
                      feature: "attempt-estimator",
                      message: "Sign in to access premium features.",
                      returnPath: "/shared-screens/schedule-details",
                    });
                    if (authResult === null || authResult === false) {
                      return;
                    }
                    if (isSubscribed) {
                      router.push({
                        pathname: "/shared-screens/attempt-estimator",
                        params: {
                          sessionNumber: params.sessionNumber,
                          platform: params.platform,
                          meet: params.meet,
                        },
                      });
                    } else {
                      router.push({
                        pathname: "/shared-screens/paywall",
                        params: {
                          from: "/shared-screens/schedule-details",
                          feature: "attempt-estimator",
                        },
                      } as any);
                    }
                  }}
                >
                  <ThemedText
                    style={[styles.premiumButtonText, { color: colors.text }]}
                  >
                    Attempt Estimator
                  </ThemedText>
                  <IconSymbol name="chevron.right" size={13} color="#007AFF" />
                </Pressable>
              </View>
            </View>
          </View>

          <SessionAthletes
            sessionNumber={parseInt(params.sessionNumber)}
            platform={params.platform}
            sessionWeightClass={sessionWeightClass || params.weightClass}
            refreshKey={refreshKey}
          />
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  card: {
    borderRadius: 10,
    marginBottom: 16,
    overflow: "hidden",
  },
  section: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: 13,
    marginBottom: 4,
  },
  value: {
    fontSize: 17,
  },
  sessionSummary: {
    fontSize: 17,
    fontWeight: "600",
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
  headerLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  linkButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
  },
  linkText: {
    fontSize: 15,
    fontWeight: "500",
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
  platformRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  platformWeightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  inlineBullet: {
    fontSize: 15,
    marginTop: -1,
  },
  inlineValue: {
    fontSize: 15,
    fontWeight: "500",
  },
  platformBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    width: 80,
    alignItems: "center",
  },
  platformText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "600",
  },
  buttonContainer: {
    padding: 16,
    gap: 12,
    flexDirection: "row",
  },
  saveButton: {
    backgroundColor: "#007AFF",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    flex: 1,
  },
  saveButtonPressed: {
    opacity: 0.8,
  },
  saveButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
  calendarButton: {
    backgroundColor: "#34C759", // iOS green
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    flex: 1,
  },
  calendarButtonPressed: {
    opacity: 0.8,
  },
  calendarButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
  lastSection: {
    borderBottomWidth: 0,
  },
  sectionTopDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  linksContainer: {
    marginTop: 12,
    gap: 8,
  },
  premiumBadgeContainer: {
    flex: 1,
    marginLeft: 16,
    justifyContent: "center",
  },
  premiumBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: "center",
  },
  premiumText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },
  premiumButtonsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  premiumButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
  },
  premiumButtonText: {
    fontSize: 15,
    flex: 1,
  },
  verticalDivider: {
    width: 1,
    height: 24,
    marginHorizontal: 8,
  },
  premiumValueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  premiumValueText: {
    fontSize: 13,
    fontWeight: "500",
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
