import {
  getAthleteBestsBatch,
  getCachedAthleteBestsBatch,
} from "@/lib/athlete-bests";
import SessionSortControl from "@/components/schedule-details/sessionSort/SessionSortControl";
import type {
  SortDirection,
  SortKey,
} from "@/components/schedule-details/sessionSort/types";
import { Button } from "@/components/ui/Button";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { LiftResult, SupabaseBests } from "@/data/types/athletes";
import { MeetName } from "@/data/types/meet";
import { useAppColors } from "@/hooks/useAppColors";
import { useIsOffline } from "@/hooks/useIsOffline";
import type { UseMeetAthletesReturn } from "@/hooks/useMeetAthletes";
import { useRequirePremium } from "@/hooks/useRequirePremium";
import { loadFailureCopy } from "@/lib/load-failure";
import { SessionAthlete } from "@/types/schedule-details";
import {
  createSessionDetailsDeepLink,
  normalizeDeepLinkHref,
} from "@/utils/deepLinks";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    View
} from "react-native";
import { devInfo } from "@/lib/logger";
import { sortSessionAthletes } from "@/lib/session-athlete-sort";
import { Palette } from "@/constants/Palette";

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

/**
 * The session's athletes card. The screen owns the roster (`athletesState`,
 * from `useSessionAthletes`) so its pull-to-refresh can await the athletes
 * refresh with the schedule's and report a failure; this card only renders it.
 */
export default function SessionAthletes({
  sessionNumber,
  platform,
  meetId,
  athletesState,
}: {
  sessionNumber: number;
  platform: string;
  meetId: MeetName;
  athletesState: UseMeetAthletesReturn;
}) {
  const router = useRouter();
  const colors = useAppColors();
  const {
    athletes: sessionAthletes,
    isLoading,
    isRefreshing,
    loadError,
    refreshAthletes,
  } = athletesState;
  const [isOffline] = useIsOffline();
  const [athleteBests, setAthleteBests] = useState<
    Record<string, SupabaseBests>
  >({});
  const [sortKey, setSortKey] = useState<SortKey>("entryTotal");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  // An unknown entitlement shows the locked UI, but a tap on it never opens
  // the paywall: `requirePremium` says it can't confirm the subscription.
  const { requirePremium, requireAuth, access } = useRequirePremium();
  const isSubscribed = access === "granted";
  // Where sign-in and the paywall send the user back to. The bare route path
  // used to be passed, so the return landed on a details screen with no
  // meet, session or platform and rendered blank.
  const returnPath = useMemo(() => {
    const href = normalizeDeepLinkHref(
      createSessionDetailsDeepLink({ meet: meetId, sessionNumber, platform }),
    );
    return typeof href === "string" ? href : "/shared-screens/schedule-details";
  }, [meetId, sessionNumber, platform]);
  const loadStartedAtRef = useRef(performance.now());
  const loggedLoadRef = useRef(false);
  const bestsLoadStartedAtRef = useRef(performance.now());
  const loggedBestsLoadRef = useRef(false);

  useEffect(() => {
    loadStartedAtRef.current = performance.now();
    loggedLoadRef.current = false;
  }, [meetId, platform, sessionNumber]);

  useEffect(() => {
    if (!__DEV__ || loggedLoadRef.current || isLoading) {
      return;
    }
    if (sessionAthletes.length === 0) {
      return;
    }

    loggedLoadRef.current = true;
    const elapsedMs = Math.round(performance.now() - loadStartedAtRef.current);
    devInfo("[perf] session athletes ready", {
      elapsedMs,
      meetId,
      sessionNumber,
      platform,
      athleteCount: sessionAthletes.length,
    });
  }, [isLoading, meetId, platform, sessionAthletes.length, sessionNumber]);

  const athletes = useMemo(
    () => toSessionAthletesByPlatform(platform, sessionAthletes),
    [platform, sessionAthletes],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadBests() {
      if (!isSubscribed) {
        setAthleteBests({});
        return;
      }

      const athleteNames = sessionAthletes.map((athlete) => athlete.name);

      if (athleteNames.length === 0) {
        setAthleteBests({});
        return;
      }

      try {
        bestsLoadStartedAtRef.current = performance.now();
        loggedBestsLoadRef.current = false;

        const cachedBestsMap = await getCachedAthleteBestsBatch(athleteNames);
        if (cancelled) return;

        setAthleteBests(cachedBestsMap);

        if (__DEV__ && !loggedBestsLoadRef.current) {
          loggedBestsLoadRef.current = true;
          devInfo("[perf] session bests cache ready", {
            elapsedMs: Math.round(
              performance.now() - bestsLoadStartedAtRef.current,
            ),
            meetId,
            sessionNumber,
            platform,
            athleteCount: athleteNames.length,
          });
        }

        const bestsMap = await getAthleteBestsBatch(athleteNames, meetId);
        if (cancelled) return;
        setAthleteBests(bestsMap);

        if (__DEV__) {
          devInfo("[perf] session bests ready", {
            elapsedMs: Math.round(
              performance.now() - bestsLoadStartedAtRef.current,
            ),
            meetId,
            sessionNumber,
            platform,
            athleteCount: athleteNames.length,
          });
        }
      } catch (error) {
        if (cancelled) return;
        console.error("Error loading athlete bests:", error);
        setAthleteBests({});
      }
    }

    void loadBests();

    return () => {
      cancelled = true;
    };
  }, [isSubscribed, meetId, platform, sessionAthletes, sessionNumber]);

  const sortedAthletes = useMemo(() => {
    const entries = Object.entries(athletes).map(
      ([platformName, platformAthletes]) =>
        [
          platformName,
          sortSessionAthletes(platformAthletes, athleteBests, sortKey, sortDirection),
        ] as const,
    );
    return Object.fromEntries(entries);
  }, [athletes, athleteBests, sortKey, sortDirection]);

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

  const handleSortSelect = useCallback(
    (key: SortKey, direction: SortDirection) => {
      setSortKey(key);
      setSortDirection(direction);
    },
    [],
  );

  // Unlocking needs nothing more: once the entitlement is known the control
  // re-renders unlocked.
  const handleSortLockedPress = useCallback(() => {
    requirePremium({
      feature: "sort-athletes",
      message: "Sign in to access premium features.",
      returnPath,
    });
  }, [requirePremium, returnPath]);

   
  const loading = isLoading || (sessionAthletes.length === 0 && isRefreshing);

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
                <SessionSortControl
                  isSubscribed={isSubscribed}
                  sortLabel={sortLabel}
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  sortOptions={sortOptions}
                  onSelect={handleSortSelect}
                  onLockedPress={handleSortLockedPress}
                />
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
    if (loadError) {
      // The card used to vanish here, which read as "nobody in this
      // session" when the request had failed.
      const failure = loadFailureCopy("session athletes", isOffline);
      return (
        <View>
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <View
              style={[
                styles.titleSection,
                { borderBottomColor: colors.border },
              ]}
            >
              <ThemedText style={styles.athletesTitle}>
                Session Athletes
              </ThemedText>
            </View>
            <View style={styles.loadingContainer} testID="session-athletes-load-error">
              <ThemedText style={styles.athletesTitle}>{failure.title}</ThemedText>
              <ThemedText
                style={[styles.loadingText, { color: colors.secondaryText, textAlign: "center" }]}
              >
                {failure.message}
              </ThemedText>
              <Button
                title="Retry"
                onPress={() => {
                  void refreshAthletes();
                }}
              />
            </View>
          </View>
        </View>
      );
    }
    // No meet to ask about (a broken link): nothing to say about athletes.
    if (!meetId) return null;
    // An answer with nobody in it: the card stays, with a message, instead
    // of vanishing (which read the same as a failed load used to).
    return (
      <View>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View
            style={[
              styles.titleSection,
              { borderBottomColor: colors.border },
            ]}
          >
            <ThemedText style={styles.athletesTitle}>
              Session Athletes
            </ThemedText>
          </View>
          <View style={styles.loadingContainer} testID="session-athletes-empty">
            <ThemedText
              style={[styles.loadingText, { color: colors.secondaryText, textAlign: "center" }]}
            >
              No athletes yet. They will appear here once the start list is
              published.
            </ThemedText>
          </View>
        </View>
      </View>
    );
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
            <SessionSortControl
              isSubscribed={isSubscribed}
              sortLabel={sortLabel}
              sortKey={sortKey}
              sortDirection={sortDirection}
              sortOptions={sortOptions}
              onSelect={handleSortSelect}
              onLockedPress={handleSortLockedPress}
            />
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
                  ) : (
                    <Pressable
                      style={({ pressed }) => [
                        styles.premiumStatsContainer,
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() => {
                        requirePremium({
                          feature: "athlete-bests",
                          message: "Sign in to access premium features.",
                          returnPath,
                        });
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

                {isSubscribed ? (
                  <Pressable
                    style={({ pressed }) => [
                      styles.meetResultsButton,
                      pressed && { opacity: 0.8 },
                    ]}
                    onPress={() => {
                      const authResult = requireAuth({
                        feature: "athlete-results",
                        message: "Sign in to access premium features.",
                        returnPath,
                      });
                      if (authResult === null || authResult === false) {
                        return;
                      }
                      router.push({
                        pathname: "/shared-screens/athlete-results",
                        params: { name: athlete.name },
                      });
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
                ) : null}
              </View>
            ))}
          </View>
        ))}
      </View>
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
    color: Palette.systemBlue,
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
    backgroundColor: Palette.systemBlue,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginTop: 4,
  },
  premiumUnlockText: {
    color: Palette.white,
    fontSize: 13,
    fontWeight: "600",
  },
});
